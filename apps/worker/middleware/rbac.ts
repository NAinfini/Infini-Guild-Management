import { ERROR_STATUS, hasRoleAtLeast } from "@guild/shared";
import type { Role, StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";

type SessionUser = { id: string; role: Role };
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

/**
 * Middleware-level RBAC guard — use on route groups for blanket protection.
 * For individual handlers that need the authenticated user object, use the
 * controller-level `requireRole()` pattern defined in each route file instead.
 */
export function requireRole(roles: Role[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = (c.get("user") as SessionUser | null) ?? null;
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
 */
export function requireRoleOrError(c: Context, requiredRole: Role): SessionUser | Response {
  const user = (c.get("user") as SessionUser | null) ?? null;
  if (!user) return buildError(c, "UNAUTHORIZED", "Authentication required");
  if (!hasRoleAtLeast(user.role, requiredRole)) return buildError(c, "FORBIDDEN", "Insufficient role");
  return user;
}
