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
  const exportHistory = vi.fn().mockResolvedValue({
    content: "[]", contentType: "application/json; charset=utf-8", filename: "history.json",
  });
  const updateMemberStats = vi.fn().mockResolvedValue([]);
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
    service: { listHistory, export: exportHistory, updateMemberStats } as unknown as GuildWarService,
  }));
  return { app, exportHistory, listHistory, updateMemberStats };
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

describe("guild-war export HTTP query", () => {
  it("normalizes and forwards only the validated export filters", async () => {
    const { app, exportHistory } = fixture();
    const response = await app.request(
      "/api/guild-war/export?format=json&history_id=history-1&event_id=event-1&date_from=2026-08-01T00%3A00%3A00.000Z&date_to=2026-08-09T00%3A00%3A00.000Z",
    );

    expect(response.status).toBe(200);
    expect(exportHistory).toHaveBeenCalledWith(expect.anything(), "json", {
      historyId: "history-1",
      eventId: "event-1",
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-09T00:00:00.000Z",
    });
  });

  it.each([
    "format=xml",
    "event_id=",
    `event_id=${"x".repeat(129)}`,
    "history_id=",
    `history_id=${"x".repeat(129)}`,
    "date_from=not-a-date",
    "date_from=2026-08-10T00%3A00%3A00.000Z&date_to=2026-08-09T00%3A00%3A00.000Z",
    "format=csv&format=json",
    "unexpected=true",
  ])("returns 400 before export for %s", async (query) => {
    const { app, exportHistory } = fixture();
    const response = await app.request(`/api/guild-war/export?${query}`);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error_code: "VALIDATION_ERROR" }));
    expect(exportHistory).not.toHaveBeenCalled();
  });
});

describe("guild-war history member stats HTTP concurrency", () => {
  it("forwards the editor's If-Match revision to the service", async () => {
    const { app, updateMemberStats } = fixture();
    const response = await app.request("/api/guild-war/history/war-1/member-stats/batch", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"history-war-1-4"',
      },
      body: JSON.stringify({
        updates: [{ user_id: "user-1", stats: { stats: { kills: 9 } } }],
      }),
    });

    expect(response.status).toBe(200);
    expect(updateMemberStats).toHaveBeenCalledWith(
      expect.anything(),
      "war-1",
      [{ user_id: "user-1", data: { stats: { kills: 9 } } }],
      '"history-war-1-4"',
    );
  });

  it.each([undefined, "*"])("rejects a missing or wildcard history revision before mutation", async (ifMatch) => {
    const { app, updateMemberStats } = fixture();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ifMatch) headers["If-Match"] = ifMatch;

    const response = await app.request("/api/guild-war/history/war-1/member-stats/user-1", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ stats: { kills: 9 } }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error_code: "VALIDATION_ERROR" }));
    expect(updateMemberStats).not.toHaveBeenCalled();
  });
});
