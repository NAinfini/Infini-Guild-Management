import type { SqlExecutor } from "@guild/kernel";
import { DatabaseSync } from "node:sqlite";
import { AuditService, type AuditEventWrite } from "@guild/server/modules/audit";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAuditStore } from "./audit-store.js";

describe("SqliteAuditStore", () => {
  it("pages identical timestamps without OFFSET duplicates or gaps", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL, actor_label TEXT, subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, subject_label TEXT, action TEXT NOT NULL,
      payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    )`);
    const insert = database.prepare(`INSERT INTO audit_log
      (id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id, subject_label,
        action, payload_json, occurred_at)
      VALUES (?, 'request-1', 'user', 'admin-1', 'admin', 'event', 'event-1', 'Event',
        'update', '{"schema_version":2,"changes":[],"context":[]}', ?)`);
    for (const id of ["audit-a", "audit-b", "audit-c", "audit-d"]) {
      insert.run(id, "2026-08-09T12:00:00.000Z");
    }
    const service = new AuditService(new SqliteAuditStore(new SqliteTestExecutor(database)));
    const request = createRequestContext({
      requestId: "request-list",
      authorization: createAuthorizationContext({
        userId: "admin-1", sessionId: "session-1", roleId: "admin", roleLevel: 900,
        permissions: new Set(["admin.audit.view"]),
      }),
      now: "2026-08-09T13:00:00.000Z",
    });

    const first = await service.list(request, { limit: 2, subjectType: "event", subjectId: "event-1" });
    const second = await service.list(request, {
      limit: 2, cursor: first.next_cursor!, subjectType: "event", subjectId: "event-1",
    });

    expect(first.data.map((row) => row.event_id)).toEqual(["audit-d", "audit-c"]);
    expect(second.data.map((row) => row.event_id)).toEqual(["audit-b", "audit-a"]);
    expect(second.next_cursor).toBeNull();
    database.close();
  });

  it("persists an export audit as a single audit_log insert", async () => {
    const execute = vi.fn().mockResolvedValue({});
    const store = new SqliteAuditStore({ execute } as unknown as SqlExecutor);
    const mutation: AuditEventWrite = {
      eventId: "audit-1",
      requestId: "request-1",
      actorKind: "user",
      actorId: "admin-1",
      actorLabel: null,
      subjectType: "audit_log_export",
      subjectId: "request-1",
      subjectLabel: null,
      action: "export_filtered_csv",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "subject_type", value: { type: "code", value: "event" } }],
      },
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
    expect(statement.sql).toContain("actor_label");
    expect(statement.sql).toContain("SELECT display_name FROM users WHERE id = ?");
    expect(statement.params?.filter((value: unknown) => value === "admin-1")).toHaveLength(2);
  });
});
