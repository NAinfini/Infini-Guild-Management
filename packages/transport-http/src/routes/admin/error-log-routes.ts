import { ERROR_LOG_SOURCES, type ErrorLogService, type ErrorLogSource } from "@guild/server/modules/audit";
import { Hono } from "hono";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { validation } from "../../core/parsing.js";

export function createErrorLogRoutes(
  dependencies: Readonly<{ service: Pick<ErrorLogService, "list"> }>,
): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  routes.get("/error-log", async (context) => {
    const sourceValue = context.req.query("source")?.trim() || null;
    if (sourceValue !== null && !ERROR_LOG_SOURCES.includes(sourceValue as ErrorLogSource)) {
      throw validation("Invalid error log source");
    }
    return context.json(await dependencies.service.list(requestContext(context), {
      source: sourceValue as ErrorLogSource | null,
      page: positiveInteger(context.req.query("page"), 1, 100, "page"),
      limit: positiveInteger(context.req.query("limit"), 50, 100, "limit"),
    }));
  });
  return routes;
}

function positiveInteger(value: string | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw validation(`Invalid error log ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw validation(`Invalid error log ${name}`);
  return parsed;
}
