import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import { ErrorLogService, type ErrorLogStore } from "./error-log.js";

function context(permissions: readonly string[]) {
  return createRequestContext({
    requestId: "request-1",
    now: "2026-08-09T00:00:00.000Z",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 900,
      permissions,
    }),
  });
}

function store(): ErrorLogStore {
  return { insert: vi.fn(), list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 5, total_pages: 1 }) };
}

describe("ErrorLogService", () => {
  it("records a bounded request error without copying arbitrary context", async () => {
    const value = store();
    await new ErrorLogService(value).recordUnexpected({
      error: new Error("database failed"),
      requestId: "request-1",
      requestPath: "/api/test",
      requestMethod: "post",
      createdAt: "2026-08-09T00:00:00.000Z",
    });

    expect(value.insert).toHaveBeenCalledWith(expect.objectContaining({
      source: "request",
      message: "database failed",
      requestId: "request-1",
      requestMethod: "POST",
    }));
  });

  it("requires status permission and bounds pagination", async () => {
    const value = new ErrorLogService(store());
    await expect(value.list(context([]), { source: null, page: 1, limit: 5 })).rejects.toMatchObject({ status: 403 });
    await expect(value.list(context(["admin.status.view"]), { source: null, page: 101, limit: 5 }))
      .rejects.toMatchObject({ status: 400 });
  });
});
