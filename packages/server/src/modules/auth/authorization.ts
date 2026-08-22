import { type Permission } from "@guild/shared/constants/roles";
import { AppError, type AuthenticatedActor, type AuthorizationContext } from "@guild/kernel";

export function requirePermission(
  authorization: AuthorizationContext,
  permission: Permission,
): AuthenticatedActor {
  return authorization.require(permission);
}

export function requireAnyPermission(
  authorization: AuthorizationContext,
  permissions: readonly Permission[],
): AuthenticatedActor {
  const actor = authorization.requireAuthenticated();
  if (!permissions.some((permission) => authorization.has(permission))) {
    throw new AppError({ code: "FORBIDDEN", status: 403, message: "Insufficient permission" });
  }
  return actor;
}

export function assertTargetBelowActor(
  actor: AuthenticatedActor,
  target: { userId: string; roleId: string; roleLevel: number },
  options: { allowSelf: boolean },
): void {
  if (target.userId === actor.userId) {
    if (options.allowSelf) return;
    throw new AppError({ code: "CONFLICT", status: 409, message: "You cannot perform this action on yourself" });
  }
  if (target.roleLevel >= actor.roleLevel) {
    throw new AppError({
      code: "FORBIDDEN",
      status: 403,
      message: "You cannot manage a user at or above your role level",
    });
  }
}

export function assertRoleAssignable(
  actor: AuthenticatedActor,
  role: { id: string; level: number; permissions: ReadonlySet<Permission> },
): void {
  const sameRole = role.id === actor.roleId && role.level === actor.roleLevel;
  if (role.level > actor.roleLevel || (role.level === actor.roleLevel && !sameRole)) {
    throw new AppError({
      code: "FORBIDDEN",
      status: 403,
      message: "You cannot assign a higher role or a different role at your own level",
    });
  }
  const escalated = [...role.permissions].filter((permission) => !actor.permissions.has(permission));
  if (escalated.length > 0) {
    throw new AppError({
      code: "FORBIDDEN",
      status: 403,
      message: `You cannot grant permissions you do not hold: ${escalated.join(", ")}`,
      details: { permissions: escalated },
    });
  }
}
