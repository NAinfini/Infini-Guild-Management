import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { GuildWarService } from "@guild/server/modules/guild-war";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createGuildWarRoutes } from "./guild-war-routes.js";

function fixture() {
  const listHistory = vi.fn().mockResolvedValue({
    data: [], total: 0, page: 1, limit: 20, total_pages: 0,
  });
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: "2026-08-09T00:00:00.000Z",
      authorization: createAuthorizationContext(null),
    }));
    await next();
  });
  app.route("/api/guild-war", createGuildWarRoutes({
    service: { listHistory } as unknown as GuildWarService,
  }));
  return { app, listHistory };
}

describe("guild-war history HTTP query", () => {
  it("passes a validated query to the service", async () => {
    const { app, listHistory } = fixture();
    const response = await app.request(
      "/api/guild-war/history?page=1&limit=20&date_from=2026-08-01T00%3A00%3A00.000Z&search=Rivals",
    );

    expect(response.status).toBe(200);
    expect(listHistory).toHaveBeenCalledWith(expect.anything(), {
      page: 1,
      limit: 20,
      dateFrom: "2026-08-01T00:00:00.000Z",
      search: "Rivals",
    });
  });

  it.each([
    "limit=21",
    "limit=oops",
    "page=0",
    "page=10001",
    "date_from=not-a-date",
    "date_from=2026-08-10T00%3A00%3A00.000Z&date_to=2026-08-09T00%3A00%3A00.000Z",
    `search=${"x".repeat(49)}`,
    "unexpected=true",
  ])("returns 400 before presentation for %s", async (query) => {
    const { app, listHistory } = fixture();
    const response = await app.request(`/api/guild-war/history?${query}`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error_code: "VALIDATION_ERROR" }));
    expect(listHistory).not.toHaveBeenCalled();
  });
});
