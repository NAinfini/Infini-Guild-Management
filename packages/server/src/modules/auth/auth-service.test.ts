import { describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "@guild/shared";
import type { AccountProvisioningStore, AuthStore, LoginAccountRecord } from "./auth-types";
import { AuthService } from "./auth-service";
import { createInviteTokenCodec, createPasswordHash, PASSWORD_HASH_ITERATIONS } from "./crypto";

const NOW = "2026-08-09T12:00:00.000Z";
const provisioning = {} as AccountProvisioningStore;
const PROFILE: MemberProfile = {
  user_id: "user-1", power: 0, classes: [], title_html: null, bio: null,
  avatar_media_id: null, images: [], audio_media_id: null, audio_name: null,
  video_urls: [], availability: null, vacation_start: null, vacation_end: null,
  notes: null, created_at: NOW, updated_at: NOW,
};

function account(passwordHash: string): LoginAccountRecord {
  return {
    id: "user-1", username: "member", roleId: "member", roleName: "Member", roleColor: null,
    roleLevel: 100, permissions: new Set(), isActive: true, deletedAt: null, revisionToken: "user-v1",
    createdAt: NOW, updatedAt: NOW, passwordHash,
  };
}

function serviceFor(record: LoginAccountRecord, configuredIterations: number) {
  const rehashPassword = vi.fn(async () => undefined);
  const store = {
    findLoginAccount: vi.fn(async () => record),
    readLoginFailure: vi.fn(async () => null),
    recordLoginFailure: vi.fn(async () => ({ failCount: 1, lockedUntil: null })),
    pruneLoginFailures: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined),
    rehashPassword,
    createSessionBounded: vi.fn(async () => undefined),
  } as unknown as AuthStore;
  return {
    rehashPassword,
    service: new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      passwordIterations: configuredIterations,
      generateToken: () => "raw-session-token",
    }),
  };
}

describe("AuthService password cost policy", () => {
  it("uses the Cloudflare-safe 10,000 iteration floor", () => {
    expect(PASSWORD_HASH_ITERATIONS).toBe(10_000);
  });

  it("rejects unsafe construction", () => {
    expect(() => serviceFor(account("invalid"), PASSWORD_HASH_ITERATIONS - 1)).toThrow(/PBKDF2 iterations/);
  });

  it("upgrades only canonical hashes below the configured cost and never downgrades", async () => {
    const older = await createPasswordHash("password-123", PASSWORD_HASH_ITERATIONS);
    const upgrade = serviceFor(account(older), PASSWORD_HASH_ITERATIONS + 1);
    await upgrade.service.login({ username: "member", password: "password-123", stayLoggedIn: false, now: NOW });
    expect(upgrade.rehashPassword).toHaveBeenCalledOnce();

    const stronger = await createPasswordHash("password-123", PASSWORD_HASH_ITERATIONS + 1);
    const preserve = serviceFor(account(stronger), PASSWORD_HASH_ITERATIONS);
    await preserve.service.login({ username: "member", password: "password-123", stayLoggedIn: false, now: NOW });
    expect(preserve.rehashPassword).not.toHaveBeenCalled();
  });

  it("rejects hashes below the runtime security floor", async () => {
    const weakHash = "pbkdf2-sha256$1000$ABEiM0RVZneImaq7zN3u_w$37Izw7UGVXXvQEMoyIGgy6cbcYD3Ipii7cXqXzpMAvk";
    const migrated = serviceFor(account(weakHash), PASSWORD_HASH_ITERATIONS);
    await expect(migrated.service.login({
      username: "member", password: "correct horse battery staple", stayLoggedIn: false, now: NOW,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(migrated.rehashPassword).not.toHaveBeenCalled();
  });
});

describe("AuthService persistent login locks", () => {
  it("returns 429 on the failure that first creates a lock and includes its deadline", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const recordLoginFailure = vi.fn(async () => ({
      failCount: 4,
      lockedUntil: "2026-08-09T12:00:30.000Z",
    }));
    const pruneLoginFailures = vi.fn(async () => undefined);
    const store = {
      findLoginAccount: vi.fn(async () => account(passwordHash)),
      readLoginFailure: vi.fn(async () => null),
      recordLoginFailure,
      pruneLoginFailures,
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });

    await expect(service.login({ username: "Member", password: "wrong", stayLoggedIn: false, now: NOW }))
      .rejects.toMatchObject({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many failed login attempts. Try again in 30 seconds.",
        details: { retry_after_seconds: 30, locked_until: "2026-08-09T12:00:30.000Z" },
      });
    expect(recordLoginFailure).toHaveBeenCalledOnce();
    expect(pruneLoginFailures).toHaveBeenCalledWith(
      "2026-08-08T12:00:00.000Z",
      NOW,
      100,
    );
  });

  it("rejects an active lock before account lookup or password KDF", async () => {
    const findLoginAccount = vi.fn();
    const recordLoginFailure = vi.fn();
    const consume = vi.fn();
    const store = {
      readLoginFailure: vi.fn(async () => ({ failCount: 4, lockedUntil: "2026-08-09T12:00:30.000Z" })),
      findLoginAccount,
      recordLoginFailure,
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      loginRateLimiter: { consume },
    });
    await expect(service.login({
      username: "Member", password: "wrong", stayLoggedIn: false, now: NOW, clientIdentifier: "127.0.0.1",
    }))
      .rejects.toMatchObject({ status: 429 });
    expect(findLoginAccount).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("rate-limits only an unlocked login before account lookup", async () => {
    const findLoginAccount = vi.fn();
    const consume = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const service = new AuthService({
      store: {
        readLoginFailure: vi.fn(async () => null),
        findLoginAccount,
      } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      loginRateLimiter: { consume },
    });
    await expect(service.login({
      username: "Member", password: "wrong", stayLoggedIn: false, now: NOW, clientIdentifier: "127.0.0.1",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retry_after_seconds: 9 },
    });
    expect(consume).toHaveBeenCalledWith("auth:login:127.0.0.1:member");
    expect(findLoginAccount).not.toHaveBeenCalled();
  });

  it("uses the same verifier and response for unknown and real usernames", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const make = (loginAccount: LoginAccountRecord | null) => new AuthService({
      store: {
        findLoginAccount: async () => loginAccount,
        readLoginFailure: async () => null,
        recordLoginFailure: async () => ({ failCount: 1, lockedUntil: null }),
        pruneLoginFailures: async () => undefined,
      } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });
    const capture = async (service: AuthService) => {
      try {
        await service.login({ username: "candidate", password: "wrong", stayLoggedIn: false, now: NOW });
      } catch (error) {
        return error;
      }
      throw new Error("Expected login rejection");
    };
    const known = await capture(make(account(passwordHash)));
    const unknown = await capture(make(null));
    expect(known).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(unknown).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
  });
});
