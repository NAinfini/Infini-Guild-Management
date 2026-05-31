import { describe, expect, it, vi } from "vitest";
import { AdminService } from "../AdminService";

function createService(db: unknown) {
  return new AdminService({
    db: db as never,
    media: {} as never,
    rawDb: { batch: vi.fn(), prepare: vi.fn() } as never,
    writeAuditLog: vi.fn(),
    writeAuditLogDurable: vi.fn(),
    createPasswordHash: vi.fn(),
    generateId: () => "id-1",
    generateInviteCode: () => "invite-1",
    generateTemporaryPassword: () => "temporary-password",
    now: () => new Date("2026-05-18T00:00:00.000Z"),
  });
}

describe("AdminService role assignment guardrails", () => {
  it("blocks non-admins from assigning roles with high-risk permissions", async () => {
    const update = vi.fn();
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ roleId: "moderator", level: 50 }]),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ id: "role-danger", level: 10 }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { permission: "admin.users.role", granted: true },
          ]),
        })),
      });
    const service = createService({ select, update });

    const result = await service.updateUserRole("actor-1", "target-1", "role-danger");

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "Only admin can assign roles containing high-risk permissions",
    });
    expect(update).not.toHaveBeenCalled();
  });
});
