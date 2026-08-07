import { ERROR_STATUS } from "@guild/shared";
import type { Permission, StandardErrorResponse } from "@guild/shared";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveSession, type SessionUser } from "../services/auth";

type ErrorStatusCode = 401 | 403;

function buildError(c: Context, code: "UNAUTHORIZED" | "FORBIDDEN", message: string): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const payload: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
  };
  return c.json(payload, ERROR_STATUS[code] as ErrorStatusCode);
}

export async function getRequestUser(c: Context): Promise<SessionUser | null> {
  const cached = c.get("user") as SessionUser | null | undefined;
  if (cached !== undefined) return cached;
  return (await resolveSession(c))?.user ?? null;
}

/**
 * Resolves the session and enforces a permission. Throws an HTTPException
 * carrying a standard error envelope (caught by the global error handler)
 * instead of returning a Response, so route handlers never need
 * `instanceof Response` checks.
 */
export async function requirePermission(
  c: Context,
  permission: Permission | readonly Permission[],
): Promise<SessionUser> {
  const user = (await resolveSession(c))?.user ?? null;
  if (!user) throw new HTTPException(401, { res: buildError(c, "UNAUTHORIZED", "Authentication required") });
  const required = typeof permission === "string" ? [permission] : permission;
  if (!required.some((candidate) => user.permissions.has(candidate))) {
    throw new HTTPException(403, { res: buildError(c, "FORBIDDEN", "Insufficient permission") });
  }
  return user;
}
