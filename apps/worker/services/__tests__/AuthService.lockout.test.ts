import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../AuthService";

const NOW = new Date("2026-07-25T00:00:00.000Z");

const ACCOUNT = {
  id: "user-1",
  username: "Victim",
  role: "member",
  isActive: true,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  passwordHash: "hash",
  salt: "salt",
};

/**
 * Mock DB for the two reads `login` performs before it can fail: the lockout
 * row, then the account row. Writes (insert/update/delete) are accepted and
 * discarded — the ladder arithmetic is covered in login-lockout.test.ts.
 */
function createMockDb(lockRow: { failCount: number; lockedUntil: string | null } | null, account: typeof ACCOUNT | null) {
  const select = vi.fn()
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(lockRow ? [lockRow] : []) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(account ? [account] : []) }) }) }),
    });
  return {
    select,
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: () => Promise.resolve([{ failCount: 4 }]) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  } as never;
}

function createDeps() {
  return {
    rawDb: {} as never,
    createPasswordHash: vi.fn(),
    verifyPassword: vi.fn().mockResolvedValue(false),
    createSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
  };
}

describe("AuthService.login lockout", () => {
  it("refuses a locked account before checking the password, so attempts cannot extend the lock", async () => {
    const deps = createDeps();
    const service = new AuthService(createMockDb({ failCount: 5, lockedUntil: "2026-07-25T00:01:00.000Z" }, ACCOUNT), deps);

    const result = await service.login("Victim", "whatever", false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.message).toContain("60 seconds");
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
  });

  it("audits a wrong password without recording the password itself", async () => {
    const deps = createDeps();
    const service = new AuthService(createMockDb(null, ACCOUNT), deps);

    const result = await service.login("Victim", "hunter2-secret", false, "203.0.113.7");

    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", message: "Invalid credentials" });
    expect(deps.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = deps.writeAuditLog.mock.calls[0]?.[0] as { action: string; actorId: string; detailText: string };
    expect(entry.action).toBe("login_failed");
    expect(entry.actorId).toBe("user-1");
    expect(JSON.stringify(entry)).not.toContain("hunter2-secret");
    expect(JSON.parse(entry.detailText)).toEqual({
      reason: "wrong_password",
      client_ip: "203.0.113.7",
      fail_count: 4,
      locked_for_seconds: 30,
    });
  });

  it("records an unknown username on the ladder but writes no audit row for it", async () => {
    const deps = createDeps();
    const service = new AuthService(createMockDb(null, null), deps);

    const result = await service.login("ghost", "whatever", false);

    // Identical to the wrong-password response: no username-enumeration oracle.
    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", message: "Invalid credentials" });
    expect(deps.verifyPassword).toHaveBeenCalledTimes(1);
    expect(deps.writeAuditLog).not.toHaveBeenCalled();
  });
});
