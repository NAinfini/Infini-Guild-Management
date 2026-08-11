import type { SqlExecutor } from "@guild/kernel";
import type { AuditMutation } from "@guild/server/modules/audit";
import { describe, expect, it, vi } from "vitest";
import { SqliteAuditStore } from "./audit-store.js";

describe("SqliteAuditStore", () => {
  it("persists an export audit as a single audit_log insert", async () => {
    const execute = vi.fn().mockResolvedValue({});
    const store = new SqliteAuditStore({ execute } as unknown as SqlExecutor);
    const mutation: AuditMutation = {
      id: "audit-1",
      requestId: "request-1",
      actorUserId: "admin-1",
      entityType: "audit_log_export",
      entityId: "request-1",
      action: "export_filtered_csv",
      summary: "Filtered CSV audit export",
      details: { entityType: "event" },
      occurredAt: "2026-08-09T12:00:00.000Z",
    };

    await store.recordExport(mutation);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      method: "run",
      params: expect.arrayContaining(["audit-1", "audit_log_export", "export_filtered_csv"]),
    });
    const statement = execute.mock.calls[0]?.[0];
    if (!statement) {
      throw new Error("expected an audit insert statement");
    }
    expect(statement.sql).toContain("actor_username");
    expect(statement.sql).toContain("SELECT username FROM users WHERE id = ?");
    expect(statement.params?.filter((value: unknown) => value === "admin-1")).toHaveLength(2);
  });
});
