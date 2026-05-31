import { describe, expect, it, vi } from "vitest";
import { AdminAuditService } from "../AdminAuditService";

function createService(db: unknown) {
  return new AdminAuditService({
    db: db as never,
    media: {} as never,
    writeAuditLog: vi.fn(),
    generateId: () => "id-1",
    signingSecret: "test-secret",
    now: () => new Date("2026-05-22T12:00:00.000Z"),
  });
}

describe("AdminAuditService", () => {
  const row = {
    id: "audit-1",
    entityType: "game_data",
    action: "upload",
    actorId: "admin-user-id",
    actorUsername: "GuildAdmin",
    entityId: "game-data-1",
    diffTitle: "v1",
    detailText: null,
    createdAt: "2026-05-22T00:00:00.000Z",
  };

  it("includes actor usernames when listing audit logs", async () => {
    const offset = vi.fn().mockResolvedValue([row]);
    const limitRows = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit: limitRows }));
    const whereRows = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where: whereRows }));
    const fromRows = vi.fn(() => ({ leftJoin }));
    const whereCount = vi.fn().mockResolvedValue([{ count: 1 }]);
    const fromCount = vi.fn(() => ({ where: whereCount }));
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: fromRows })
      .mockReturnValueOnce({ from: fromCount });

    const result = await createService({ select }).listAuditLogs({
      page: "1",
      limit: "50",
      start_at: "2026-05-22T00:00:00.000Z",
      end_at: "2026-05-22T23:59:59.999Z",
    });

    expect(result.data[0]).toMatchObject({
      actor_id: "admin-user-id",
      actor_username: "GuildAdmin",
    });
    expect(leftJoin).toHaveBeenCalled();
  });

  it("includes actor usernames in audit log exports", async () => {
    const orderBy = vi.fn().mockResolvedValue([row]);
    const where = vi.fn(() => ({ orderBy }));
    const leftJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ leftJoin }));
    const select = vi.fn(() => ({ from }));

    const result = await createService({ select }).exportAuditLogs("admin-user-id", {
      format: "csv",
      start_at: "2026-05-22T00:00:00.000Z",
      end_at: "2026-05-22T23:59:59.999Z",
    });

    expect(result.body).toContain("actor_id,actor_username");
    expect(result.body).toContain("\"admin-user-id\",\"GuildAdmin\"");
  });
});
