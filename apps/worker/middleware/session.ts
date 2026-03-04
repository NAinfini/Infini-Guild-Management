import { ERROR_STATUS } from "@guild/shared";
import type { StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";
import { resolveSession } from "../services/auth";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

function unauthorized(c: Context): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: "UNAUTHORIZED",
    message: "Authentication required",
    request_id: requestId,
  };
  return c.json(body, ERROR_STATUS.UNAUTHORIZED as ErrorStatusCode);
}

export async function sessionMiddleware(c: Context, next: Next): Promise<void> {
  const resolved = await resolveSession(c);
  c.set("user", resolved?.user ?? null);
  await next();
}

export async function requireSessionMiddleware(c: Context, next: Next): Promise<Response | void> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return unauthorized(c);
  }

  c.set("user", resolved.user);
  await next();
}
