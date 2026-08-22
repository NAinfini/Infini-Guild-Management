import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { AuditEvent } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createRequestContextMiddleware } from "../../core/request-context-middleware.js";
import { createAuditRoutes } from "./audit-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";

describe("audit export route", () => {
  it("passes cursor and an exact indexed subject target to the list service", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const app = buildApp({
      list,
      recordExport: vi.fn().mockResolvedValue(undefined),
      export: vi.fn(() => emptyRows()),
    });

    const response = await app.request(
      "/api/admin/audit-log?limit=25&cursor=opaque&entity_type=event&entity_id=event-1&actor_id=user-1",
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      limit: 25,
      cursor: "opaque",
      subjectType: "event",
      subjectId: "event-1",
      actorId: "user-1",
    }));
  });

  it("persists the export audit before creating the response stream", async () => {
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const exportRows = vi.fn(() => emptyRows());
    const app = buildApp({ recordExport, export: exportRows });

    const response = await app.request("/api/admin/audit-log/export?format=json&entity_type=event");

    expect(response.status).toBe(200);
    expect(recordExport).toHaveBeenCalledWith(expect.anything(), "json", expect.objectContaining({
      subjectType: "event",
    }));
    expect(recordExport.mock.invocationCallOrder[0]).toBeLessThan(exportRows.mock.invocationCallOrder[0]!);
  });

  it("breaks formula-leading cells and names the file after the requested range", async () => {
    const app = buildApp({
      recordExport: vi.fn().mockResolvedValue(undefined),
      export: vi.fn(() => oneRow()),
    });

    const response = await app.request(
      `/api/admin/audit-log/export?format=csv&start_at=${NOW}&end_at=${NOW}`,
    );

    expect(response.headers.get("Content-Disposition"))
      .toContain("guild-audit-2026-08-09-to-2026-08-09.csv");
    const csv = await response.text();
    expect(csv).toContain("event_id,subject_type,action,actor_id");
    // 表格软件会把 = 开头的单元格当公式执行，导出前加一个单引号打断它。
    expect(csv).toContain(`"'  =SUM(1,2)"`);
  });

  it("does not start an export when recording its audit fails", async () => {
    const exportRows = vi.fn(() => emptyRows());
    const app = buildApp({
      recordExport: vi.fn().mockRejectedValue(new Error("write failed")),
      export: exportRows,
    });

    const response = await app.request("/api/admin/audit-log/export?format=csv");

    expect(response.status).toBe(500);
    expect(exportRows).not.toHaveBeenCalled();
  });
});

function buildApp(service: Readonly<{
  list?: ReturnType<typeof vi.fn>;
  recordExport: ReturnType<typeof vi.fn>;
  export: ReturnType<typeof vi.fn>;
}>): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => createRequestContext({
    requestId: "audit-export-request",
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 900,
      permissions: new Set(["admin.audit.view", "admin.audit.export"]),
    }),
    now: NOW,
  })));
  app.onError(createHttpErrorHandler());
  app.route("/api/admin", createAuditRoutes({
    service: {
      list: service.list ?? vi.fn(),
      recordExport: service.recordExport,
      export: service.export,
    } as never,
  }));
  return app;
}

async function* emptyRows() {}

async function* oneRow() {
  yield {
    event_id: "audit-1",
    request_id: "request-1",
    actor: { kind: "user", id: "user-1", label: "admin" },
    subject: { type: "announcement", id: "announcement-1", label: "  =SUM(1,2)" },
    action: "update",
    payload: {
      schema_version: 2,
      changes: [{
        field: "title",
        before: { type: "text", value: "Before" },
        after: { type: "text", value: "After" },
      }],
      context: [],
    },
    occurred_at: NOW,
  } satisfies AuditEvent;
}
