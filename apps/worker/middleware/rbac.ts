import { ERROR_STATUS, hasRoleAtLeast } from "@guild/shared";
import type { Permission, Role, StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";
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

export async function requirePermission(c: Context, permission: Permission): Promise<SessionUser | Response> {
  const user = await getRequestUser(c);
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!user.permissions.has(permission)) return buildError(c, "FORBIDDEN", "Insufficient permission");
  return user;
}

export async function requireAnyPermission(
  c: Context,
  permissions: readonly Permission[],
): Promise<SessionUser | Response> {
  const user = await getRequestUser(c);
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!permissions.some((p) => user.permissions.has(p))) return buildError(c, "FORBIDDEN", "Insufficient permission");
  return user;
}

/**
 * Middleware-level RBAC guard — use on route groups for blanket protection.
 * For individual handlers that need the authenticated user object, use the
 * controller-level `requirePermission()` pattern defined in each route file instead.
 */
export function requireRole(roles: Role[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = await getRequestUser(c);
    if (!user) {
      return buildError(c, "UNAUTHORIZED", "Authentication required");
    }

    const isAllowed = roles.some((role) => hasRoleAtLeast(user.role, role));
    if (!isAllowed) {
      return buildError(c, "FORBIDDEN", "Insufficient role");
    }

    await next();
  };
}

/**
 * Controller-level RBAC check — returns the session user for use in handlers.
 * Preferred when the handler needs access to the authenticated user's id/role.
 * @deprecated Use requirePermission() instead for granular permission checks.
 */
export function requireRoleOrError(c: Context, requiredRole: Role): SessionUser | Response {
  const user = (c.get("user") as SessionUser | null) ?? null;
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!hasRoleAtLeast(user.role, requiredRole)) return buildError(c, "FORBIDDEN", "Insufficient role");
  return user;
}
