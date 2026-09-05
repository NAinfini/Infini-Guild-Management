import { describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "@guild/shared";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTask,
} from "@guild/kernel";
import type { AccountProvisioningStore, AuthStore, InviteRecord, LoginAccountRecord } from "./auth-types";
import { AuthService } from "./auth-service";
import {
  createPasswordHash,
  PASSWORD_HASH_ITERATIONS,
} from "./crypto";
import { assertPasswordPolicy } from "./password-policy";

const NOW = "2026-08-09T12:00:00.000Z";
const LOGIN_CLIENT = "198.51.100.10";
const provisioning = {} as AccountProvisioningStore;
const PROFILE: MemberProfile = {
  user_id: "user-1", power: 0, classes: [], title_html: null, bio: null,
  avatar_media_id: null, images: [], audio_media_id: null, audio_name: null,
  video_urls: [], availability: null, vacation_start: null, vacation_end: null,
  notes: null, created_at: NOW, updated_at: NOW,
};

describe("new password policy", () => {
  it("requires 8–128 characters and character composition without a common-password check", () => {
    expect(() => assertPasswordPolicy("Correct horse battery staple!")).not.toThrow();
    expect(() => assertPasswordPolicy("Violet7!")).not.toThrow();
    expect(() => assertPasswordPolicy("short12")).toThrow(/between 8 and 128/);
    expect(() => assertPasswordPolicy("a".repeat(129))).toThrow(/between 8 and 128/);
    expect(() => assertPasswordPolicy("violet7!")).toThrow(/uppercase/);
    expect(() => assertPasswordPolicy("VIOLET7!")).toThrow(/lowercase/);
    expect(() => assertPasswordPolicy("Violet7 ")).toThrow(/special/);
    expect(() => assertPasswordPolicy("Password1!")).not.toThrow();
  });
});

describe("AuthService password-reset identity guard", () => {
  it("rejects a reserved replacement login name before reading or changing credentials", async () => {
    const findUser = vi.fn();
    const findCredentialRecord = vi.fn();
    const completeTemporaryPasswordAndOpenSession = vi.fn();
    const service = new AuthService({
      store: { findUser, findCredentialRecord, completeTemporaryPasswordAndOpenSession } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
    });
    const passwordChangeContext = createRequestContext({
      requestId: "request-password-reset",
      now: NOW,
      authorization: createAuthorizationContext({
        userId: "user-1",
        sessionId: "password-change-session",
        roleId: "member",
        roleLevel: 100,
        permissions: [],
        sessionScope: "password_change",
      }),
    });

    await expect(service.completePasswordReset(passwordChangeContext, {
      loginName: " systemtest_reset ",
      newPassword: "password",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400, message: "Login name is reserved" });
    expect(findUser).not.toHaveBeenCalled();
    expect(findCredentialRecord).not.toHaveBeenCalled();
    expect(completeTemporaryPasswordAndOpenSession).not.toHaveBeenCalled();
  });
});

describe("AuthService realtime authorization invalidation", () => {
  it("publishes a targeted refresh after deleting a logout session", async () => {
    const tasks: DeferredTask[] = [];
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new AuthService({
      store: { deleteSession } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      notifications: { publish },
      deferred: { defer: (task) => { tasks.push(task); } },
    });

    await expect(service.logout("raw-session-token")).resolves.toEqual({ ok: true });

    const tokenDigest = deleteSession.mock.calls[0]?.[0] as string;
    expect(tokenDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(publish).toHaveBeenCalledWith({
      type: "authorization_refresh",
      session_ids: [tokenDigest],
    });
  });
});

const INVITE: InviteRecord = {
  id: "internal-invite-id",
  code: "A1B2C3D4E5",
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

function account(passwordHash: string, overrides: Partial<LoginAccountRecord> = {}): LoginAccountRecord {
  return {
    id: "user-1", displayName: "member", loginName: "member", roleId: "member", roleName: "Member", roleColor: null,
    roleLevel: 100, permissions: new Set(), isActive: true, deletedAt: null, revisionToken: "user-v1",
    createdAt: NOW, updatedAt: NOW, lastLoginAt: null, passwordHash,
    authRevision: 1,
    temporaryPasswordExpiresAt: null, temporaryPasswordUsedAt: null,
    ...overrides,
  };
}

function serviceFor(record: LoginAccountRecord, configuredIterations: number) {
  const rehashPassword = vi.fn(async () => true);
  const store = {
    findLoginAccount: vi.fn(async () => record),
    rehashPassword,
    openUserSession: vi.fn(async () => true),
  } as unknown as AuthStore;
  return {
    rehashPassword,
    service: new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      passwordIterations: configuredIterations,
      generateToken: () => "raw-session-token",
    }),
  };
}

describe("AuthService password cost policy", () => {
  it("uses the 10,000 iteration Worker cost for newly written hashes", () => {
    expect(PASSWORD_HASH_ITERATIONS).toBe(10_000);
  });

  it("rejects unsafe construction", () => {
    expect(() => serviceFor(account("invalid"), PASSWORD_HASH_ITERATIONS - 1)).toThrow(/PBKDF2 iterations/);
  });

  it("keeps the Worker cost and upgrades only when a deployment explicitly configures more", async () => {
    const workerCost = "pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw";
    const current = serviceFor(account(workerCost), PASSWORD_HASH_ITERATIONS);
    await current.service.login({ loginName: "member", password: "admin123", stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT });
    expect(current.rehashPassword).not.toHaveBeenCalled();

    const upgrade = serviceFor(account(workerCost), PASSWORD_HASH_ITERATIONS + 1);
    await upgrade.service.login({ loginName: "member", password: "admin123", stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT });
    expect(upgrade.rehashPassword).toHaveBeenCalledOnce();

    const stronger = await createPasswordHash("password-123", PASSWORD_HASH_ITERATIONS + 1);
    const underBudget = serviceFor(account(stronger), PASSWORD_HASH_ITERATIONS);
    await expect(underBudget.service.login({
      loginName: "member", password: "password-123", stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    expect(underBudget.rehashPassword).not.toHaveBeenCalled();

    const preserve = serviceFor(account(stronger), PASSWORD_HASH_ITERATIONS + 1);
    await preserve.service.login({ loginName: "member", password: "password-123", stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT });
    expect(preserve.rehashPassword).not.toHaveBeenCalled();
  });

  it("rejects hashes below the runtime security floor", async () => {
    const weakHash = "pbkdf2-sha256$1000$ABEiM0RVZneImaq7zN3u_w$37Izw7UGVXXvQEMoyIGgy6cbcYD3Ipii7cXqXzpMAvk";
    const migrated = serviceFor(account(weakHash), PASSWORD_HASH_ITERATIONS);
    await expect(migrated.service.login({
      loginName: "member", password: "correct horse battery staple", stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(migrated.rehashPassword).not.toHaveBeenCalled();
  });
});

describe("AuthService private login failures", () => {
  it("rate-limits every login before account lookup", async () => {
    const findLoginAccount = vi.fn();
    const consumeIp = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const consumeLoginName = vi.fn(async () => ({ allowed: true }));
    const service = new AuthService({
      store: { findLoginAccount } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      loginIpRateLimiter: { consume: consumeIp },
      loginNameRateLimiter: { consume: consumeLoginName },
    });
    await expect(service.login({
      loginName: "Member", password: "wrong", stayLoggedIn: false, now: NOW, clientIdentifier: "127.0.0.1",
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { retry_after_seconds: 9 },
    });
    expect(consumeIp).toHaveBeenCalledWith("auth:login:ip:127.0.0.1");
    expect(consumeLoginName).not.toHaveBeenCalled();
    expect(findLoginAccount).not.toHaveBeenCalled();
  });

  it("keeps the login-name bucket source-scoped to avoid cross-source account denial", async () => {
    const findLoginAccount = vi.fn();
    const consumeIp = vi.fn(async () => ({ allowed: true }));
    const consumeLoginName = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const service = new AuthService({
      store: { findLoginAccount } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      loginIpRateLimiter: { consume: consumeIp },
      loginNameRateLimiter: { consume: consumeLoginName },
    });

    await expect(service.login({
      loginName: "Member", password: "wrong", stayLoggedIn: false, now: NOW, clientIdentifier: "127.0.0.1",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retry_after_seconds: 9 } });
    expect(consumeIp).toHaveBeenCalledWith("auth:login:ip:127.0.0.1");
    expect(consumeLoginName).toHaveBeenCalledWith("auth:login:name:127.0.0.1:member");
    expect(consumeIp.mock.invocationCallOrder[0]).toBeLessThan(consumeLoginName.mock.invocationCallOrder[0]!);
    expect(findLoginAccount).not.toHaveBeenCalled();
  });

  it("uses the same response for every unusable or invalid credential", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const make = (loginAccount: LoginAccountRecord | null) => new AuthService({
      store: {
        findLoginAccount: async () => loginAccount,
      } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
    });
    const capture = async (service: AuthService, password = "wrong") => {
      try {
        await service.login({ loginName: "candidate", password, stayLoggedIn: false, now: NOW, clientIdentifier: LOGIN_CLIENT });
      } catch (error) {
        return error;
      }
      throw new Error("Expected login rejection");
    };
    const failures = await Promise.all([
      capture(make(account(passwordHash))),
      capture(make(null)),
      capture(make(account(passwordHash, { isActive: false })), "password-123"),
      capture(make(account(passwordHash, { deletedAt: NOW })), "password-123"),
      capture(make(account(passwordHash, {
        temporaryPasswordExpiresAt: "2026-08-09T11:59:59.000Z",
      })), "password-123"),
    ]);
    for (const failure of failures) {
      expect(failure).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "Invalid credentials" });
    }
  });
});

describe("AuthService invite codes", () => {
  it("normalizes and verifies only a matching 10-character code", async () => {
    const code = "A1B2C3D4E5";
    const findActiveInvite = vi.fn(async (candidate: string) => candidate === code ? INVITE : null);
    const service = new AuthService({
      store: { findActiveInvite } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
    });

    await expect(service.verifyInvite(code.toLowerCase(), NOW)).resolves.toMatchObject({ valid: true, roleId: "member" });
    await expect(service.verifyInvite("not-valid", NOW)).resolves.toEqual({ valid: false });
    await expect(service.verifyInvite(`${code.slice(0, -1)}!`, NOW)).resolves.toEqual({ valid: false });
    expect(findActiveInvite).toHaveBeenCalledTimes(1);
    expect(findActiveInvite).toHaveBeenCalledWith(code, NOW);
  });

  it("resolves the internal invite id before the atomic registration redemption", async () => {
    const code = "A1B2C3D4E5";
    const redeemInviteAndCreateMember = vi.fn<AccountProvisioningStore["redeemInviteAndCreateMember"]>(
      async () => "created" as const,
    );
    const createdUser = account("unused");
    const store = {
      findActiveInvite: vi.fn(async () => INVITE),
      findUser: vi.fn(async () => createdUser),
      findCredentialRecord: vi.fn(async () => ({
        loginName: createdUser.loginName,
        passwordHash: createdUser.passwordHash,
        authRevision: createdUser.authRevision,
      })),
      openUserSession: vi.fn(async () => true),
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning: { redeemInviteAndCreateMember } as unknown as AccountProvisioningStore,
      profiles: { readOwnProfile: async () => PROFILE },
      generateId: () => createdUser.id,
      generateToken: () => "session-token",
    });
    const request = createRequestContext({
      requestId: "register-request",
      now: NOW,
      authorization: createAuthorizationContext(null),
    });

    await expect(service.register(request, {
      inviteCode: code,
      loginName: "member-login",
      displayName: "member",
      password: "Password-123456",
    })).resolves.toMatchObject({ user: { id: createdUser.id } });
    expect(redeemInviteAndCreateMember).toHaveBeenCalledOnce();
    const [registration, audit] = redeemInviteAndCreateMember.mock.calls[0]!;
    expect(registration).toMatchObject({
      inviteId: INVITE.id,
      inviteCode: code,
      userId: createdUser.id,
      loginName: "member-login",
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

  function sessionService(
    lastLoginAt: string | null,
    scope: "normal" | "password_change" = "normal",
    expiresAt = "2026-09-08T00:00:00.000Z",
  ) {
    const recordLastLogin = vi.fn(async () => undefined);
    const store = {
      findSessionAuthorization: vi.fn(async (tokenDigest: string) => ({
        id: "user-1", displayName: "member", roleId: "member", roleName: "Member", roleColor: null,
        roleLevel: 100, permissions: new Set<string>(), isActive: true, deletedAt: null,
        revisionToken: "user-v1", createdAt: SESSION_START, updatedAt: SESSION_START, lastLoginAt,
        tokenDigest, expiresAt, sessionCreatedAt: SESSION_START, sessionScope: scope,
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

  it("never renews a restricted password-change session", async () => {
    const restricted = sessionService(
      "2026-08-09T11:30:00.000Z",
      "password_change",
      "2026-08-09T12:01:00.000Z",
    );
    const resolved = await restricted.service.resolveAuthorization("raw-session-token", NOW);
    expect(resolved.session?.renewedExpiresAt).toBeNull();
  });
});
