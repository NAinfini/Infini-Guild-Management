import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createRequestContextMiddleware } from "../../core/request-context-middleware.js";
import { createAuditRoutes } from "./audit-routes.js";

describe("audit export route", () => {
  it("persists the export audit before creating the response stream", async () => {
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const exportRows = vi.fn(() => emptyRows());
    const app = buildApp({ recordExport, export: exportRows });

    const response = await app.request("/api/admin/audit-log/export?format=json&entity_type=event");

    expect(response.status).toBe(200);
    expect(recordExport).toHaveBeenCalledWith(expect.anything(), "json", expect.objectContaining({
      entityType: "event",
    }));
    expect(recordExport.mock.invocationCallOrder[0]).toBeLessThan(exportRows.mock.invocationCallOrder[0]!);
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
      permissions: new Set(["admin.audit.export"]),
    }),
    now: "2026-08-09T12:00:00.000Z",
  })));
  app.onError(createHttpErrorHandler());
  app.route("/api/admin", createAuditRoutes({ service: service as never }));
  return app;
}

async function* emptyRows() {}
