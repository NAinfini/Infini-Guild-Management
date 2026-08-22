import { describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "@guild/shared";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AccountProvisioningStore, AuthStore, InviteRecord, LoginAccountRecord } from "./auth-types";
import { AuthService } from "./auth-service";
import { createInviteTokenCodec, createPasswordHash, digestToken, PASSWORD_HASH_ITERATIONS } from "./crypto";

const NOW = "2026-08-09T12:00:00.000Z";
const provisioning = {} as AccountProvisioningStore;
const PROFILE: MemberProfile = {
  user_id: "user-1", power: 0, classes: [], title_html: null, bio: null,
  avatar_media_id: null, images: [], audio_media_id: null, audio_name: null,
  video_urls: [], availability: null, vacation_start: null, vacation_end: null,
  notes: null, created_at: NOW, updated_at: NOW,
};
const INVITE: InviteRecord = {
  id: "internal-invite-id",
  createdBy: "admin-1",
  roleId: "member",
  roleName: "Member",
  roleColor: null,
  roleLevel: 100,
  maxUses: 2,
  usedCount: 0,
  expiresAt: null,
  createdAt: NOW,
  revokedAt: null,
};

function account(passwordHash: string): LoginAccountRecord {
  return {
    id: "user-1", username: "member", roleId: "member", roleName: "Member", roleColor: null,
    roleLevel: 100, permissions: new Set(), isActive: true, deletedAt: null, revisionToken: "user-v1",
    createdAt: NOW, updatedAt: NOW, lastLoginAt: null, passwordHash,
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
    openUserSession: vi.fn(async () => undefined),
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

  it("lets correct credentials clear an attacker-created lock", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const findLoginAccount = vi.fn(async () => account(passwordHash));
    const recordLoginFailure = vi.fn();
    const clearLoginFailures = vi.fn(async () => undefined);
    const openUserSession = vi.fn(async () => undefined);
    const consume = vi.fn(async () => ({ allowed: true }));
    const readLoginFailure = vi.fn(async () => ({
      failCount: 4,
      lockedUntil: "2026-08-09T12:00:30.000Z",
    }));
    const store = {
      readLoginFailure,
      findLoginAccount,
      recordLoginFailure,
      clearLoginFailures,
      openUserSession,
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      loginRateLimiter: { consume },
    });
    await expect(service.login({
      username: "Member", password: "password-123", stayLoggedIn: false, now: NOW,
      clientIdentifier: "127.0.0.1",
    })).resolves.toMatchObject({ user: { id: "user-1" } });
    expect(consume.mock.invocationCallOrder[0]).toBeLessThan(readLoginFailure.mock.invocationCallOrder[0]!);
    expect(findLoginAccount).toHaveBeenCalledOnce();
    expect(recordLoginFailure).not.toHaveBeenCalled();
    expect(clearLoginFailures).toHaveBeenCalledWith("member");
  });

  it("rate-limits every login before failure-state or account lookup", async () => {
    const findLoginAccount = vi.fn();
    const readLoginFailure = vi.fn();
    const consume = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const service = new AuthService({
      store: {
        readLoginFailure,
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
    expect(readLoginFailure).not.toHaveBeenCalled();
    expect(findLoginAccount).not.toHaveBeenCalled();
  });

  it("keeps an active lock for invalid credentials without extending it", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const recordLoginFailure = vi.fn();
    const store = {
      readLoginFailure: vi.fn(async () => ({ failCount: 4, lockedUntil: "2026-08-09T12:00:30.000Z" })),
      findLoginAccount: vi.fn(async () => account(passwordHash)),
      recordLoginFailure,
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
    });

    await expect(service.login({ username: "Member", password: "wrong", stayLoggedIn: false, now: NOW }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(recordLoginFailure).not.toHaveBeenCalled();
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

describe("AuthService short invite codes", () => {
  it("verifies only a matching ten-character code digest", async () => {
    const inviteTokens = createInviteTokenCodec("0123456789abcdef0123456789abcdef");
    const code = await inviteTokens.encode(INVITE.id);
    const tokenDigest = await digestToken(code);
    const findActiveInvite = vi.fn(async (digest: string) => digest === tokenDigest ? INVITE : null);
    const service = new AuthService({
      store: { findActiveInvite } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens,
    });

    await expect(service.verifyInvite(code, NOW)).resolves.toMatchObject({ valid: true, roleId: "member" });
    await expect(service.verifyInvite("not-valid", NOW)).resolves.toEqual({ valid: false });
    await expect(service.verifyInvite(`${code.slice(0, -1)}!`, NOW)).resolves.toEqual({ valid: false });
    expect(findActiveInvite).toHaveBeenCalledTimes(1);
    expect(findActiveInvite).toHaveBeenCalledWith(tokenDigest, NOW);
  });

  it("resolves the internal invite id before the atomic registration redemption", async () => {
    const inviteTokens = createInviteTokenCodec("0123456789abcdef0123456789abcdef");
    const code = await inviteTokens.encode(INVITE.id);
    const tokenDigest = await digestToken(code);
    const redeemInviteAndCreateMember = vi.fn<AccountProvisioningStore["redeemInviteAndCreateMember"]>(
      async () => "created" as const,
    );
    const createdUser = account("unused");
    const store = {
      findActiveInvite: vi.fn(async () => INVITE),
      findUser: vi.fn(async () => createdUser),
      openUserSession: vi.fn(async () => undefined),
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning: { redeemInviteAndCreateMember } as unknown as AccountProvisioningStore,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens,
      generateId: () => createdUser.id,
      generateToken: () => "session-token",
    });
    const request = createRequestContext({
      requestId: "register-request",
      now: NOW,
      authorization: createAuthorizationContext(null),
    });

    await expect(service.register(request, {
      inviteToken: code,
      username: "member",
      password: "password-123",
    })).resolves.toMatchObject({ user: { id: createdUser.id } });
    expect(redeemInviteAndCreateMember).toHaveBeenCalledOnce();
    const [registration, audit] = redeemInviteAndCreateMember.mock.calls[0]!;
    expect(registration).toMatchObject({
      inviteId: INVITE.id,
      tokenDigest,
      userId: createdUser.id,
      username: "member",
    });
    expect(audit).toMatchObject({
      actorKind: "user",
      actorId: createdUser.id,
      requestId: "register-request",
      subjectType: "user",
      subjectId: createdUser.id,
      subjectLabel: "member",
      action: "register",
      payload: {
        schema_version: 2,
        changes: [],
        context: [
          {
            field: "invite_id",
            value: { type: "reference", value: { id: INVITE.id, label: INVITE.roleName } },
          },
          {
            field: "role_id",
            value: { type: "reference", value: { id: INVITE.roleId, label: INVITE.roleName } },
          },
        ],
      },
    });
  });
});

describe("AuthService cookie session last login", () => {
  const SESSION_START = "2026-08-09T00:00:00.000Z";

  function sessionService(lastLoginAt: string | null) {
    const recordLastLogin = vi.fn(async () => undefined);
    const store = {
      findSessionAuthorization: vi.fn(async (tokenDigest: string) => ({
        id: "user-1", username: "member", roleId: "member", roleName: "Member", roleColor: null,
        roleLevel: 100, permissions: new Set<string>(), isActive: true, deletedAt: null,
        revisionToken: "user-v1", createdAt: SESSION_START, updatedAt: SESSION_START, lastLoginAt,
        tokenDigest, expiresAt: "2026-09-08T00:00:00.000Z", sessionCreatedAt: SESSION_START,
      })),
      renewSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
      recordLastLogin,
    } as unknown as AuthStore;
    return {
      recordLastLogin,
      service: new AuthService({
        store,
        provisioning,
        profiles: { readOwnProfile: async () => PROFILE },
        inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      }),
    };
  }

  it("counts a returning cookie session as a login once the stored time falls outside the window", async () => {
    const stale = sessionService("2026-08-09T10:00:00.000Z");
    const resolved = await stale.service.resolveAuthorization("raw-session-token", NOW);
    expect(stale.recordLastLogin).toHaveBeenCalledWith("user-1", NOW);
    expect(resolved.session?.record.lastLoginAt).toBe(NOW);

    const never = sessionService(null);
    await never.service.resolveAuthorization("raw-session-token", NOW);
    expect(never.recordLastLogin).toHaveBeenCalledWith("user-1", NOW);
  });

  it("leaves the stored time alone inside the window so reads do not become writes", async () => {
    const fresh = sessionService("2026-08-09T11:30:00.000Z");
    const resolved = await fresh.service.resolveAuthorization("raw-session-token", NOW);
    expect(fresh.recordLastLogin).not.toHaveBeenCalled();
    expect(resolved.session?.record.lastLoginAt).toBe("2026-08-09T11:30:00.000Z");
  });
});
