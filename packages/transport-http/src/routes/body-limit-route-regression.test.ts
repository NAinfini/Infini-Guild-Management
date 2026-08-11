import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import type { EventsService } from "@guild/server/modules/events";
import type { GuildWarService } from "@guild/server/modules/guild-war";
import type { StorageService } from "@guild/server/modules/storage";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createRequestBodyLimitMiddleware } from "../core/body-limit.js";
import { createHttpErrorHandler } from "../core/error-handler.js";
import type { HttpEnv } from "../core/http-env.js";
import { createRequestContextMiddleware } from "../core/request-context-middleware.js";
import { createEventsRoutes } from "./events/events-routes.js";
import { createGuildWarRoutes } from "./guild-war/guild-war-routes.js";
import { createStorageRoutes } from "./storage/storage-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";

describe("buffered request body route regression", () => {
  it("reuses the bounded JSON body in events routes", async () => {
    const batchDetails = vi.fn().mockResolvedValue([]);
    const app = bufferedApp();
    app.route("/api/events", createEventsRoutes({
      service: { batchDetails } as unknown as EventsService,
      stageEventImages: vi.fn(),
    }));

    const response = await postJson(app, "/api/events/batch-details", { ids: ["event-1"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(batchDetails).toHaveBeenCalledWith(expect.anything(), ["event-1"]);
  });

  it("reuses the bounded JSON body in storage routes", async () => {
    const storage = {
      id: "storage-1",
      name: "Vault",
      description: null,
      created_at: NOW,
      categories: [],
    };
    const createStorage = vi.fn().mockResolvedValue(storage);
    const app = bufferedApp();
    app.route("/api/storage", createStorageRoutes({
      service: { createStorage } as unknown as StorageService,
      parseImageFormData: vi.fn(),
    }));

    const response = await postJson(app, "/api/storage/storages", { name: "Vault" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(storage);
    expect(createStorage).toHaveBeenCalledWith(expect.anything(), { name: "Vault" });
  });

  it("reuses the bounded JSON body in guild-war routes", async () => {
    const deleteHistoryBatch = vi.fn().mockResolvedValue({ deleted: 1 });
    const app = bufferedApp();
    app.route("/api/guild-war", createGuildWarRoutes({
      service: { deleteHistoryBatch } as unknown as GuildWarService,
    }));

    const response = await postJson(app, "/api/guild-war/history/batch-delete", { ids: ["war-1"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 1 });
    expect(deleteHistoryBatch).toHaveBeenCalledWith(expect.anything(), ["war-1"]);
  });
});

function bufferedApp(): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler());
  app.use("*", createRequestBodyLimitMiddleware());
  app.use("*", createRequestContextMiddleware(() => createRequestContext({
    requestId: "request-buffered-json",
    authorization: createAuthorizationContext(null),
    now: NOW,
  })));
  return app;
}

async function postJson(app: Hono<HttpEnv>, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
