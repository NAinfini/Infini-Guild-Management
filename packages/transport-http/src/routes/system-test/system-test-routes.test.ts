import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import {
  SYSTEM_TEST_AUDIT_HEADER,
  SYSTEM_TEST_AUDIT_HEADER_VALUE,
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  SYSTEM_TEST_RUN_ID_HEADER,
} from "@guild/shared/config/system-test";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../../core/error-handler.js";
import type { HttpEnv } from "../../core/http-env.js";
import {
  createSystemTestRequestMiddleware,
  createSystemTestRoutes,
  isAnonymousSystemTestPath,
} from "./system-test-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const RUN_ID = "014f27f1-6ca1-4c5e-924f-f111b76b9efd";
const FIXTURE_ID = "7a226793-7020-4dc2-b7d8-c76e257174a3";

function requestContext() {
  return createRequestContext({
    requestId: "request-system-test",
    authorization: createAuthorizationContext({
      userId: "admin-1",
      sessionId: "session-1",
      roleId: "admin",
      roleLevel: 900,
      permissions: ["admin.status.view"],
    }),
    now: NOW,
  });
}

function buildRoutes() {
  const service = {
    createRun: vi.fn().mockResolvedValue({ runId: RUN_ID, fixtureId: FIXTURE_ID }),
    cleanupRun: vi.fn().mockResolvedValue({ ok: false, status: "running" as const, attempts: 0 }),
    finalizeRun: vi.fn().mockResolvedValue(undefined),
    beginRequest: vi.fn().mockResolvedValue(undefined),
    endRequest: vi.fn().mockResolvedValue(undefined),
  };
  const app = appWithContext();
  app.route("/api/admin", createSystemTestRoutes(service));
  return { app, service };
}

describe("system-test Portal HTTP contract", () => {
  it("keeps the public health check outside system-test persistence", async () => {
    const service = {
      beginRequest: vi.fn().mockResolvedValue(undefined),
      endRequest: vi.fn().mockResolvedValue(undefined),
    };
    const app = appWithContext();
    app.use("*", createSystemTestRequestMiddleware(service));
    app.get("/api/health", (context) => context.json({ ok: true }));

    const response = await app.request("/api/health", {
      headers: {
        [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
        [SYSTEM_TEST_RUN_ID_HEADER]: RUN_ID,
      },
    });

    expect(response.status).toBe(200);
    expect(isAnonymousSystemTestPath("GET", "/api/health")).toBe(false);
    expect(service.beginRequest).not.toHaveBeenCalled();
    expect(service.endRequest).not.toHaveBeenCalled();
  });

  it("preserves the four management paths and their DTOs", async () => {
    const { app, service } = buildRoutes();

    const created = await app.request("/api/admin/status/system-test-runs", { method: "POST" });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ run_id: RUN_ID, fixture_id: FIXTURE_ID });

    const cleanup = await app.request(`/api/admin/status/system-test-runs/${RUN_ID}/cleanup`, { method: "POST" });
    expect(cleanup.status).toBe(409);
    expect(await cleanup.json()).toEqual({ ok: false, status: "running", attempts: 0 });

    const finalized = await app.request(`/api/admin/status/system-test-runs/${RUN_ID}/finalize`, { method: "POST" });
    expect(finalized.status).toBe(200);
    expect(await finalized.json()).toEqual({ ok: true });

    const summary = {
      total: 2,
      passed: 1,
      failed: 1,
      errors: [{
        category: "System",
        label: "Admin Status",
        method: "GET",
        path: "/api/admin/status",
        status: 500,
        error: "500 Internal Server Error",
      }],
    };
    const audited = await app.request("/api/admin/status/system-test-audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
        [SYSTEM_TEST_AUDIT_HEADER]: SYSTEM_TEST_AUDIT_HEADER_VALUE,
        [SYSTEM_TEST_RUN_ID_HEADER]: RUN_ID,
      },
      body: JSON.stringify(summary),
    });
    expect(audited.status).toBe(200);
    expect(await audited.json()).toEqual({ ok: true });
    expect(service.finalizeRun).toHaveBeenLastCalledWith(expect.anything(), RUN_ID, summary);
  });

  it("rejects forged or incomplete summary headers", async () => {
    const { app, service } = buildRoutes();
    const response = await app.request("/api/admin/status/system-test-audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
        [SYSTEM_TEST_RUN_ID_HEADER]: RUN_ID,
      },
      body: JSON.stringify({ total: 0, passed: 0, failed: 0, errors: [] }),
    });
    expect(response.status).toBe(403);
    expect(service.finalizeRun).not.toHaveBeenCalled();
  });

  it("records a failed marked request before releasing its artifact lease", async () => {
    const service = {
      beginRequest: vi.fn().mockResolvedValue(undefined),
      endRequest: vi.fn().mockResolvedValue(undefined),
    };
    const recordUnexpected = vi.fn().mockResolvedValue(undefined);
    const app = appWithContext(recordUnexpected);
    app.use("*", createSystemTestRequestMiddleware(service));
    app.post("/api/events", () => { throw new Error("mutation failed"); });

    const response = await app.request("/api/events", {
      method: "POST",
      headers: {
        [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
        [SYSTEM_TEST_RUN_ID_HEADER]: RUN_ID,
      },
    });
    expect(response.status).toBe(500);
    expect(service.beginRequest).toHaveBeenCalledWith(expect.anything(), RUN_ID, false);
    expect(recordUnexpected).toHaveBeenCalledWith(
      expect.objectContaining({ message: "mutation failed" }),
      "request-system-test",
      { path: "/api/events", method: "POST", occurredAt: NOW },
    );
    expect(service.endRequest).toHaveBeenCalledWith("request-system-test");
    expect(recordUnexpected.mock.invocationCallOrder[0]).toBeLessThan(service.endRequest.mock.invocationCallOrder[0]!);
  });

  it("takes the zero-registry fast path when the system-test header is absent", async () => {
    const service = {
      beginRequest: vi.fn().mockResolvedValue(undefined),
      endRequest: vi.fn().mockResolvedValue(undefined),
    };
    const app = appWithContext();
    app.use("*", createSystemTestRequestMiddleware(service));
    app.post("/api/events", (context) => context.json({ ok: true }));

    const response = await app.request("/api/events", { method: "POST" });

    expect(response.status).toBe(200);
    expect(service.beginRequest).not.toHaveBeenCalled();
    expect(service.endRequest).not.toHaveBeenCalled();
  });

  it("fails closed on a forged marker before opening a request", async () => {
    const service = {
      beginRequest: vi.fn().mockResolvedValue(undefined),
      endRequest: vi.fn().mockResolvedValue(undefined),
    };
    const app = appWithContext();
    app.use("*", createSystemTestRequestMiddleware(service));
    app.post("/api/events", (context) => context.json({ ok: true }));

    const response = await app.request("/api/events", {
      method: "POST",
      headers: {
        [SYSTEM_TEST_HEADER]: "forged",
        [SYSTEM_TEST_RUN_ID_HEADER]: RUN_ID,
      },
    });
    expect(response.status).toBe(403);
    expect(service.beginRequest).not.toHaveBeenCalled();
  });
});

function appWithContext(onUnexpected?: (error: Error) => Promise<void>): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.onError(createHttpErrorHandler({ onUnexpected }));
  app.use("*", async (context, next) => {
    context.set("requestContext", requestContext());
    await next();
  });
  return app;
}
