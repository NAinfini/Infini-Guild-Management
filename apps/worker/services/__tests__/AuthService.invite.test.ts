import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../AuthService";

function createMockDb(usernameExists = false, createdUser?: Record<string, unknown>, createdProfile?: Record<string, unknown>) {
  const select = vi
    .fn()
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(usernameExists ? [{ id: "existing-user" }] : []),
        })),
      })),
    });
  if (createdUser) {
    select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([createdUser]) })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([createdProfile ?? {
            id: "profile-1",
            userId: "user-1",
            power: 0,
            classes: "[]",
            titleHtml: null,
            bio: null,
            avatarKey: null,
            images: "[]",
            audioKey: null,
            videoUrls: "[]",
            availability: null,
            vacationStart: null,
            vacationEnd: null,
            notes: null,
            createdAt: "2026-05-18T00:00:00.000Z",
            updatedAt: "2026-05-18T00:00:00.000Z",
          }]) })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      });
  }
  return { select } as never;
}

function createdUser() {
  return {
    id: "user-1",
    username: "newuser",
    role: "raider",
    roleName: "Raider",
    roleColor: "#123456",
    roleLevel: 200,
    isActive: true,
    deletedAt: null,
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function createMockDeps(inviteId: string | null) {
  const prepare = vi.fn((sql: string) => ({
    sql,
    bind: vi.fn(() => ({
      sql,
      all: vi.fn().mockResolvedValue({ results: [] }),
    })),
  }));
  return {
    rawDb: {
      prepare,
      batch: inviteId
        ? vi.fn().mockResolvedValue([{ results: [{ id: inviteId, role_id: "raider" }] }, {}, {}, {}])
        : vi.fn().mockRejectedValue(new Error("NOT NULL constraint failed: users.role")),
    },
    createPasswordHash: vi.fn().mockResolvedValue({ passwordHash: "hash", salt: "salt" }),
    verifyPassword: vi.fn(),
    passwordHashTargetIterations: 10_000,
    createSession: vi.fn().mockResolvedValue(undefined),
    destroySessionById: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AuthService.register invite redemption", () => {
  it("rejects unavailable invite (exhausted, revoked, expired, or nonexistent)", async () => {
    const service = new AuthService(createMockDb(), createMockDeps(null) as never);
    const result = await service.register("ANY-BAD-CODE", "newuser", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Invite link is no longer available" });
  });

  it("rejects duplicate username before checking invite", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(true), deps as never);
    const result = await service.register("VALID-CODE", "taken-name", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Username already taken" });
    expect(deps.rawDb.prepare).not.toHaveBeenCalled();
  });

  it("records only the redeemed invite id in the registration audit log", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(false, createdUser()), deps as never);

    const result = await service.register("SECRET-INVITE-CODE", "newuser", "password123");

    expect(result.ok).toBe(true);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      detailText: JSON.stringify({ invite_id: "invite-id-1" }),
    }));
    expect(JSON.stringify(deps.writeAuditLog.mock.calls)).not.toContain("SECRET-INVITE-CODE");
  });

  it("returns the created profile and D1 role metadata", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(false, createdUser()), deps as never);

    const result = await service.register("VALID-CODE", "newuser", "password123");

    expect(result).toMatchObject({
      ok: true,
      data: {
        user: {
          id: "user-1",
          username: "newuser",
          role: "raider",
          role_name: "Raider",
          role_color: "#123456",
          role_level: 200,
        },
        profile: { id: "profile-1", user_id: "user-1", power: 0 },
      },
    });
  });

  it("redeems capacity and inserts the assigned user in one atomic batch", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(false, createdUser()), deps as never);

    await service.register("VALID-CODE", "newuser", "password123");

    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
    const statements = deps.rawDb.batch.mock.calls[0]?.[0] as Array<{ sql: string }>;
    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toMatch(/UPDATE invite_links[\s\S]*used_count < max_uses[\s\S]*RETURNING id, role_id/);
    expect(statements[1]?.sql).toContain("changes() = 1");
  });

  it("relies on batch rollback for a racing duplicate without decrement compensation", async () => {
    const deps = createMockDeps("invite-id-1");
    deps.rawDb.batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed: users.username"));
    const service = new AuthService(createMockDb(), deps as never);

    const result = await service.register("VALID-CODE", "newuser", "password123");

    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Username already taken" });
    expect(deps.rawDb.batch).toHaveBeenCalledTimes(1);
    expect(deps.rawDb.prepare.mock.calls.map(([sql]) => sql).join("\n")).not.toContain("used_count - 1");
  });
});

describe("AuthService.verifyInvite", () => {
  it("returns the invite's D1 role metadata", async () => {
    const deps = createMockDeps("invite-id-1");
    deps.rawDb.prepare.mockReturnValueOnce({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: [{ role_id: "raider", role_name: "Raider", role_color: "#123456", role_level: 200 }],
        }),
      })),
    } as never);
    const service = new AuthService({ select: vi.fn() } as never, deps as never);

    const result = await service.verifyInvite("VALID-CODE");

    expect(result).toEqual({
      ok: true,
      data: { valid: true, role_id: "raider", role_name: "Raider", role_color: "#123456", role_level: 200 },
    });
  });
});

describe("AuthService.register reserved system-test username", () => {
  it("refuses to register an account into the system-test namespace", async () => {
    const select = vi.fn();
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService({ select } as never, deps as never);

    const result = await service.register("VALID-CODE", "systemtest_hijack", "password123");

    expect(result).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: 'Usernames beginning with "systemtest_" are reserved',
    });
    expect(select).not.toHaveBeenCalled();
    expect(deps.rawDb.prepare).not.toHaveBeenCalled();
  });

  it("matches the reserved prefix case-insensitively", async () => {
    const select = vi.fn();
    const service = new AuthService({ select } as never, createMockDeps("invite-id-1") as never);

    const result = await service.register("VALID-CODE", "SystemTest_Hijack", "password123");

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });
});

describe("AuthService.checkUsername reserved system-test username", () => {
  it("reports a reserved-namespace username as unavailable without querying the database", async () => {
    const select = vi.fn();
    const service = new AuthService({ select } as never, createMockDeps(null) as never);

    const result = await service.checkUsername("systemtest_foo");

    expect(result).toEqual({ ok: true, data: { available: false, reason: "reserved_prefix" } });
    expect(select).not.toHaveBeenCalled();
  });

  it("matches the reserved prefix case-insensitively", async () => {
    const service = new AuthService({ select: vi.fn() } as never, createMockDeps(null) as never);

    const result = await service.checkUsername("SystemTest_Foo");

    expect(result).toEqual({ ok: true, data: { available: false, reason: "reserved_prefix" } });
  });
});
