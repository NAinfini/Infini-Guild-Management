import { Hono } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";

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
      return context.json({ ok: true as const, request_id: requestId });
    } catch {
      return context.json({ ok: false as const, request_id: requestId }, 503);
    }
  });
  return routes;
}
