import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { ErrorLogService } from "@guild/server/modules/audit";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createErrorLogRoutes } from "./error-log-routes.js";

function app(list: ErrorLogService["list"]) {
  const value = new Hono<HttpEnv>();
  value.onError(createHttpErrorHandler());
  value.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: "2026-08-09T00:00:00.000Z",
      authorization: createAuthorizationContext({
        userId: "user-1", sessionId: "session-1", roleId: "admin", roleLevel: 900,
        permissions: ["admin.status.view"],
      }),
    }));
    await next();
  });
  value.route("/api/admin", createErrorLogRoutes({ service: { list } }));
  return value;
}

describe("error log HTTP routes", () => {
  it("parses the frozen Portal query and rejects unbounded pages", async () => {
    const list = vi.fn<ErrorLogService["list"]>()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 5, total_pages: 1 });
    const valid = await app(list).request("/api/admin/error-log?page=1&limit=5");
    expect(valid.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-1" }), {
      source: null, page: 1, limit: 5,
    });
    expect((await app(list).request("/api/admin/error-log?page=101")).status).toBe(400);
  });
});
