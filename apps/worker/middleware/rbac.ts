import { ERROR_STATUS } from "@guild/shared";
import type { Permission, StandardErrorResponse } from "@guild/shared";
import type { Context } from "hono";
import { resolveSession, type SessionUser } from "../services/auth";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

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

export async function requirePermission(c: Context, permission: Permission, options?: { freshPermissions?: boolean }): Promise<SessionUser | Response> {
  const fresh = options?.freshPermissions ?? true;
  const user = (await resolveSession(c, { freshPermissions: fresh }))?.user ?? null;
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!user.permissions.has(permission)) return buildError(c, "FORBIDDEN", "Insufficient permission");
  return user;
}
