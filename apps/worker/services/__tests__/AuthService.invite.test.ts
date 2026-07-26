import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../AuthService";

function createMockDb(usernameExists = false, createdUser?: Record<string, unknown>) {
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
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([createdUser]) })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      });
  }
  return { select } as never;
}

function createMockDeps(inviteId: string | null) {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(sql.includes("RETURNING id") ? (inviteId ? { id: inviteId } : null) : null),
      run: vi.fn().mockResolvedValue({ meta: { changes: inviteId ? 1 : 0 } }),
      all: vi.fn().mockResolvedValue({ results: [] }),
    })),
  }));
  return {
    rawDb: {
      prepare,
      batch: vi.fn().mockResolvedValue([]),
    } as never,
    createPasswordHash: vi.fn().mockResolvedValue({ passwordHash: "hash", salt: "salt" }),
    verifyPassword: vi.fn(),
    createSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    enforceSessionLimit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AuthService.register invite redemption", () => {
  it("rejects unavailable invite (exhausted, revoked, expired, or nonexistent)", async () => {
    const service = new AuthService(createMockDb(), createMockDeps(null));
    const result = await service.register("ANY-BAD-CODE", "newuser", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Invite link is no longer available" });
  });

  it("rejects duplicate username before checking invite", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(true), deps);
    const result = await service.register("VALID-CODE", "taken-name", "password123");
    expect(result).toEqual({ ok: false, code: "CONFLICT", message: "Username already taken" });
    expect((deps.rawDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
  });

  it("records only the redeemed invite id in the registration audit log", async () => {
    const deps = createMockDeps("invite-id-1");
    const service = new AuthService(createMockDb(false, {
      id: "user-1",
      username: "newuser",
      role: "member",
      isActive: true,
      deletedAt: null,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
    }), deps);

    const result = await service.register("SECRET-INVITE-CODE", "newuser", "password123");

    expect(result.ok).toBe(true);
    expect(deps.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      detailText: JSON.stringify({ invite_id: "invite-id-1" }),
    }));
    expect(JSON.stringify(deps.writeAuditLog.mock.calls)).not.toContain("SECRET-INVITE-CODE");
  });
});
