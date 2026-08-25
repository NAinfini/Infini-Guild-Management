import { describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "@guild/shared";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AccountProvisioningStore, AuthStore, InviteRecord, LoginAccountRecord } from "./auth-types";
import { AuthService } from "./auth-service";
import { createInviteTokenCodec, createPasswordHash, digestToken, PASSWORD_HASH_ITERATIONS } from "./crypto";
import { assertPasswordPolicy } from "./password-policy";

const NOW = "2026-08-09T12:00:00.000Z";
const provisioning = {} as AccountProvisioningStore;
const PROFILE: MemberProfile = {
  user_id: "user-1", power: 0, classes: [], title_html: null, bio: null,
  avatar_media_id: null, images: [], audio_media_id: null, audio_name: null,
  video_urls: [], availability: null, vacation_start: null, vacation_end: null,
  notes: null, created_at: NOW, updated_at: NOW,
};

describe("new password policy", () => {
  it("accepts any 8-to-128-character password without weak-password matching", () => {
    expect(() => assertPasswordPolicy("password")).not.toThrow();
    expect(() => assertPasswordPolicy("12345678")).not.toThrow();
    expect(() => assertPasswordPolicy("1234567")).toThrow(/between 8 and 128/);
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
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
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
    id: "user-1", displayName: "member", loginName: "member", roleId: "member", roleName: "Member", roleColor: null,
    roleLevel: 100, permissions: new Set(), isActive: true, deletedAt: null, revisionToken: "user-v1",
    createdAt: NOW, updatedAt: NOW, lastLoginAt: null, passwordHash,
    authRevision: 1,
    temporaryPasswordExpiresAt: null, temporaryPasswordUsedAt: null,
  };
}

function serviceFor(record: LoginAccountRecord, configuredIterations: number) {
  const rehashPassword = vi.fn(async () => true);
  const store = {
    findLoginAccount: vi.fn(async () => record),
    readLoginFailure: vi.fn(async () => null),
    recordLoginFailure: vi.fn(async () => ({ failCount: 1, lockedUntil: null })),
    pruneLoginFailures: vi.fn(async () => undefined),
    clearLoginFailures: vi.fn(async () => undefined),
    rehashPassword,
    openUserSession: vi.fn(async () => true),
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
    await upgrade.service.login({ loginName: "member", password: "password-123", stayLoggedIn: false, now: NOW });
    expect(upgrade.rehashPassword).toHaveBeenCalledOnce();

    const stronger = await createPasswordHash("password-123", PASSWORD_HASH_ITERATIONS + 1);
    const preserve = serviceFor(account(stronger), PASSWORD_HASH_ITERATIONS);
    await preserve.service.login({ loginName: "member", password: "password-123", stayLoggedIn: false, now: NOW });
    expect(preserve.rehashPassword).not.toHaveBeenCalled();
  });

  it("rejects hashes below the runtime security floor", async () => {
    const weakHash = "pbkdf2-sha256$1000$ABEiM0RVZneImaq7zN3u_w$37Izw7UGVXXvQEMoyIGgy6cbcYD3Ipii7cXqXzpMAvk";
    const migrated = serviceFor(account(weakHash), PASSWORD_HASH_ITERATIONS);
    await expect(migrated.service.login({
      loginName: "member", password: "correct horse battery staple", stayLoggedIn: false, now: NOW,
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

    await expect(service.login({ loginName: "Member", password: "wrong", stayLoggedIn: false, now: NOW }))
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

  it("rejects an active lock before account lookup or password verification", async () => {
    const passwordHash = await createPasswordHash("password-123");
    const findLoginAccount = vi.fn(async () => account(passwordHash));
    const recordLoginFailure = vi.fn();
    const clearLoginFailures = vi.fn(async () => undefined);
    const consumeIp = vi.fn(async () => ({ allowed: true }));
    const consumeLoginName = vi.fn(async () => ({ allowed: true }));
    const readLoginFailure = vi.fn(async () => ({
      failCount: 4,
      lockedUntil: "2026-08-09T12:00:30.000Z",
    }));
    const store = {
      readLoginFailure,
      findLoginAccount,
      recordLoginFailure,
      clearLoginFailures,
    } as unknown as AuthStore;
    const service = new AuthService({
      store,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      loginIpRateLimiter: { consume: consumeIp },
      loginNameRateLimiter: { consume: consumeLoginName },
    });
    await expect(service.login({
      loginName: "Member", password: "password-123", stayLoggedIn: false, now: NOW,
      clientIdentifier: "127.0.0.1",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(consumeIp.mock.invocationCallOrder[0]).toBeLessThan(consumeLoginName.mock.invocationCallOrder[0]!);
    expect(consumeLoginName.mock.invocationCallOrder[0]).toBeLessThan(readLoginFailure.mock.invocationCallOrder[0]!);
    expect(findLoginAccount).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
    expect(clearLoginFailures).not.toHaveBeenCalled();
  });

  it("rate-limits every login before failure-state or account lookup", async () => {
    const findLoginAccount = vi.fn();
    const readLoginFailure = vi.fn();
    const consumeIp = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const consumeLoginName = vi.fn(async () => ({ allowed: true }));
    const service = new AuthService({
      store: {
        readLoginFailure,
        findLoginAccount,
      } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
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
    expect(readLoginFailure).not.toHaveBeenCalled();
    expect(findLoginAccount).not.toHaveBeenCalled();
  });

  it("consumes the IP limiter before the IP-plus-login-name limiter", async () => {
    const readLoginFailure = vi.fn();
    const findLoginAccount = vi.fn();
    const consumeIp = vi.fn(async () => ({ allowed: true }));
    const consumeLoginName = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 }));
    const service = new AuthService({
      store: { readLoginFailure, findLoginAccount } as unknown as AuthStore,
      provisioning,
      profiles: { readOwnProfile: async () => PROFILE },
      inviteTokens: createInviteTokenCodec("0123456789abcdef0123456789abcdef"),
      loginIpRateLimiter: { consume: consumeIp },
      loginNameRateLimiter: { consume: consumeLoginName },
    });

    await expect(service.login({
      loginName: "Member", password: "wrong", stayLoggedIn: false, now: NOW, clientIdentifier: "127.0.0.1",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retry_after_seconds: 9 } });
    expect(consumeIp).toHaveBeenCalledWith("auth:login:ip:127.0.0.1");
    expect(consumeLoginName).toHaveBeenCalledWith("auth:login:name:127.0.0.1:member");
    expect(consumeIp.mock.invocationCallOrder[0]).toBeLessThan(consumeLoginName.mock.invocationCallOrder[0]!);
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

    await expect(service.login({ loginName: "Member", password: "wrong", stayLoggedIn: false, now: NOW }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("uses the same verifier and response for unknown and real login names", async () => {
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
        await service.login({ loginName: "candidate", password: "wrong", stayLoggedIn: false, now: NOW });
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
      loginName: "member-login",
      displayName: "member",
      password: "password-123456",
    })).resolves.toMatchObject({ user: { id: createdUser.id } });
    expect(redeemInviteAndCreateMember).toHaveBeenCalledOnce();
    const [registration, audit] = redeemInviteAndCreateMember.mock.calls[0]!;
    expect(registration).toMatchObject({
      inviteId: INVITE.id,
      tokenDigest,
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
