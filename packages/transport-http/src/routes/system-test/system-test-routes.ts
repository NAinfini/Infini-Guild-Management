import { AppError } from "@guild/kernel";
import type { SystemTestService } from "@guild/server/modules/system-test";
import {
  SYSTEM_TEST_AUDIT_HEADER,
  SYSTEM_TEST_AUDIT_HEADER_VALUE,
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  SYSTEM_TEST_RUN_ID_HEADER,
} from "@guild/shared/config/system-test";
import { systemTestSummarySchema } from "@guild/shared/schemas/system-test";
import { Hono, type MiddlewareHandler } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseJsonBody } from "../../core/parsing.js";
import {
  presentSystemTestCleanup,
  presentSystemTestOk,
  presentSystemTestRun,
} from "../../presenters/system-test/system-test-presenter.js";

type SystemTestHttpService = Pick<SystemTestService,
  "createRun" | "cleanupRun" | "finalizeRun" | "beginRequest" | "endRequest">;

export function createSystemTestRoutes(service: SystemTestHttpService): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.post("/status/system-test-runs", async (context) => {
    const created = await service.createRun(requestContext(context));
    return context.json(presentSystemTestRun({
      run_id: created.runId,
      fixture_id: created.fixtureId,
    }), 201);
  });

  routes.post("/status/system-test-runs/:runId/cleanup", async (context) => {
    const result = presentSystemTestCleanup(await service.cleanupRun(
      requestContext(context),
      context.req.param("runId"),
    ));
    return result.ok ? context.json(result, 200) : context.json(result, 409);
  });

  routes.post("/status/system-test-runs/:runId/finalize", async (context) => {
    await service.finalizeRun(requestContext(context), context.req.param("runId"));
    return context.json(presentSystemTestOk({ ok: true }));
  });

  routes.post("/status/system-test-audit", async (context) => {
    assertSummaryHeaders(context.req.raw);
    const runId = context.req.header(SYSTEM_TEST_RUN_ID_HEADER)!.trim();
    const summary = await parseJsonBody(context.req.raw, systemTestSummarySchema, "Invalid system test summary");
    await service.finalizeRun(requestContext(context), runId, summary);
    return context.json(presentSystemTestOk({ ok: true }));
  });

  return routes;
}

export function createSystemTestRequestMiddleware(
  service: Pick<SystemTestService, "beginRequest" | "endRequest">,
): MiddlewareHandler<HttpEnv> {
  return async (context, next) => {
    const marker = context.req.header(SYSTEM_TEST_HEADER);
    if (marker === undefined || isManagementPath(context.req.path)) return next();
    if (marker !== SYSTEM_TEST_HEADER_VALUE) throw forbidden();
    const runId = context.req.header(SYSTEM_TEST_RUN_ID_HEADER)?.trim();
    if (!runId) throw forbidden();
    const request = requestContext(context);
    await service.beginRequest(request, runId, isAnonymousSystemTestPath(context.req.method, context.req.path));
    try {
      return await next();
    } finally {
      await service.endRequest(request.requestId);
    }
  };
}

export function isAnonymousSystemTestPath(method: string, path: string): boolean {
  return (method === "GET" && path === "/api/health")
    || (method === "POST" && (path === "/api/auth/login" || /^\/api\/auth\/register\/[^/]+$/.test(path)));
}

function isManagementPath(path: string): boolean {
  return path === "/api/admin/status/system-test-runs"
    || path === "/api/admin/status/system-test-audit"
    || /^\/api\/admin\/status\/system-test-runs\/[^/]+\/(?:cleanup|finalize)$/.test(path);
}

function assertSummaryHeaders(request: Request): void {
  if (request.headers.get(SYSTEM_TEST_HEADER) !== SYSTEM_TEST_HEADER_VALUE
    || request.headers.get(SYSTEM_TEST_AUDIT_HEADER) !== SYSTEM_TEST_AUDIT_HEADER_VALUE
    || !request.headers.get(SYSTEM_TEST_RUN_ID_HEADER)?.trim()) {
    throw forbidden();
  }
}

function forbidden(): AppError {
  return new AppError({
    code: "FORBIDDEN",
    status: 403,
    message: "A valid active system-test run is required",
  });
}
