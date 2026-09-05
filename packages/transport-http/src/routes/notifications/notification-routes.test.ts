import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createNotificationInboxRoutes } from "./notification-routes.js";

function fixture(unreadCount: number) {
  const request = createRequestContext({
    requestId: "request-1",
    now: "2026-09-04T12:00:00.000Z",
    authorization: createAuthorizationContext({
      userId: "user-1",
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
    }),
  });
  const service = {
    getUnreadCount: vi.fn().mockResolvedValue({ unread_count: unreadCount }),
    list: vi.fn(),
    markRead: vi.fn(),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  };
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", request);
    await next();
  });
  app.route("/api/notifications", createNotificationInboxRoutes({ service }));
  return { app, service, request };
}

describe("notification inbox HTTP routes", () => {
  it("returns the unread-count projection using the server request context", async () => {
    const { app, service, request } = fixture(3);

    const response = await app.request("/api/notifications/unread-count");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unread_count: 3 });
    expect(service.getUnreadCount).toHaveBeenCalledWith(request);
    expect(service.list).not.toHaveBeenCalled();
  });

  it("rejects an invalid unread-count projection at the response boundary", async () => {
    const { app } = fixture(-1);

    expect((await app.request("/api/notifications/unread-count")).status).toBe(500);
  });
});
