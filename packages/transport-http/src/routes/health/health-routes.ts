import { Hono } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";

const HEALTH_CACHE = "public, max-age=0, s-maxage=30, must-revalidate, no-transform";

export type HealthHttpService = Readonly<{
  check(): Promise<void>;
}>;

export function createHealthRoutes(
  dependencies: Readonly<{ service: HealthHttpService }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/", async (context) => {
    const requestId = requestContext(context).requestId;
    try {
      await dependencies.service.check();
      return context.json(
        { ok: true as const, request_id: requestId },
        200,
        { "Cache-Control": HEALTH_CACHE },
      );
    } catch {
      return context.json(
        { ok: false as const, request_id: requestId },
        503,
        { "Cache-Control": "no-store" },
      );
    }
  });
  return routes;
}
