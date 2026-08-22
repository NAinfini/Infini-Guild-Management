import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import {
  AdminOperationsService,
  type AdminOperationsRuntimePort,
  type AdminOperationsStore,
} from "@guild/server/modules/admin-operations";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import { createAdminOperationsRoutes } from "./admin-operations-routes.js";

const NOW = "2026-08-12T12:00:00.000Z";

function app(permissions: readonly string[]) {
  const value = new Hono<HttpEnv>();
  value.onError(createHttpErrorHandler());
  value.use("*", async (context, next) => {
    context.set("requestContext", createRequestContext({
      requestId: "request-1",
      now: NOW,
      authorization: createAuthorizationContext({
        userId: "user-1",
        sessionId: "session-1",
        roleId: "admin",
        roleLevel: 1_000,
        permissions,
      }),
    }));
    await next();
  });
  return value;
}

function service() {
  const store = {
    read: vi.fn(async () => ({
      statuses: [{
        name: "media-gc" as const,
        status: "completed" as const,
        startedAt: "2026-08-12T11:59:59.000Z",
        finishedAt: NOW,
        durationMs: 1_000,
        processed: 2,
        batches: 1,
        hasMore: false,
        backlog: {
          status: "known" as const,
          countPrecision: "exact" as const,
          pendingCount: 0,
          oldestPendingAt: null,
        },
        errorSummary: null,
      }],
      leases: [{
        name: "media-gc" as const,
        acquiredAt: "2026-08-12T11:55:00.000Z",
        expiresAt: "2026-08-12T12:05:00.000Z",
      }],
      usage: {
        mediaByState: [{
          state: "attached" as const,
          assetCount: 2,
          variantCount: 3,
          logicalBytes: 400,
        }],
        auditLogCount: 5,
        auditArchiveCount: 2,
        auditArchiveBytes: 600,
      },
    })),
  } satisfies AdminOperationsStore;
  const runtime = {
    readRealtime: vi.fn(async () => ({
      state: "unavailable" as const,
      runtimeSource: "cloudflare-notifications-do" as const,
      observedAt: NOW,
      connectionCount: null,
    })),
  } satisfies AdminOperationsRuntimePort;
  return { store, runtime, service: new AdminOperationsService(store, runtime) };
}

describe("admin operations HTTP route", () => {
  it("requires admin.status.view", async () => {
    const value = app([]);
    value.route("/", createAdminOperationsRoutes({ service: service().service }));
    expect((await value.request("/")).status).toBe(403);
  });

  it("returns all eight jobs, exact metadata usage, and explicit realtime unavailability", async () => {
    const fixture = service();
    const value = app(["admin.status.view"]);
    value.route("/", createAdminOperationsRoutes({ service: fixture.service }));

    const response = await value.request("/");
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.scheduled_jobs).toHaveLength(8);
    expect(body.scheduled_jobs[0]).toMatchObject({
      name: "recurrence-materialization",
      schedule: "quarter-hourly",
      status: "never-run",
      lease: { state: "none" },
    });
    expect(body.scheduled_jobs[4]).toMatchObject({
      name: "media-gc",
      schedule: "quarter-hourly",
      status: "running",
      processed: null,
      finished_at: null,
      lease: {
        state: "held",
        acquired_at: "2026-08-12T11:55:00.000Z",
        expires_at: "2026-08-12T12:05:00.000Z",
      },
    });
    expect(body.scheduled_jobs[5]).toMatchObject({ name: "audit-archive", schedule: "daily" });
    expect(body.realtime).toEqual({
      state: "unavailable",
      runtime_source: "cloudflare-notifications-do",
      observed_at: NOW,
      connection_count: null,
    });
    expect(body.managed_data_usage).toEqual({
      media: {
        asset_count: 2,
        variant_count: 3,
        logical_bytes: 400,
        by_state: [
          { state: "uploading", asset_count: 0, variant_count: 0, logical_bytes: 0 },
          { state: "staged", asset_count: 0, variant_count: 0, logical_bytes: 0 },
          { state: "attached", asset_count: 2, variant_count: 3, logical_bytes: 400 },
          { state: "deleting", asset_count: 0, variant_count: 0, logical_bytes: 0 },
        ],
      },
      audit: { log_count: 5, archive_count: 2, archive_bytes: 600 },
    });
    expect(fixture.store.read).toHaveBeenCalledWith(NOW);
  });
});
