import {
  PERMISSIONS,
  PERMISSION_ID,
  SITE_OWNER_LEVEL,
  SITE_OWNER_ROLE_ID,
  type Permission,
} from "@guild/shared/constants/roles";
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
  options: { allowSelf: boolean; allowOwnerPeer?: boolean },
): void {
  const ownerPeer = options.allowOwnerPeer === true
    && isSiteOwner(actor)
    && target.roleId === SITE_OWNER_ROLE_ID
    && target.roleLevel === SITE_OWNER_LEVEL;
  if (target.userId === actor.userId) {
    if (options.allowSelf || ownerPeer) return;
    throw new AppError({ code: "CONFLICT", status: 409, message: "You cannot perform this action on yourself" });
  }
  if (target.roleLevel >= actor.roleLevel && !ownerPeer) {
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
  assertOwnerRoleDefinition(role);
  const ownerPeerAssignment = isSiteOwner(actor)
    && role.id === SITE_OWNER_ROLE_ID
    && role.level === SITE_OWNER_LEVEL;
  if (role.level >= actor.roleLevel && !ownerPeerAssignment) {
    throw new AppError({
      code: "FORBIDDEN",
      status: 403,
      message: "You cannot assign a role at or above your own level",
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

export function assertOwnerRoleDefinition(
  role: { id: string; level: number; permissions: ReadonlySet<Permission> },
): void {
  if (role.id === SITE_OWNER_ROLE_ID) {
    if (role.level !== SITE_OWNER_LEVEL || PERMISSIONS.some((permission) => !role.permissions.has(permission))) {
      throw new AppError({
        code: "CONFLICT",
        status: 409,
        message: "The site owner role must remain at level 1000 with every permission",
      });
    }
    return;
  }
  if (role.permissions.has(PERMISSION_ID.ADMIN_OWNERS_MANAGE)) {
    throw new AppError({
      code: "FORBIDDEN",
      status: 403,
      message: "Owner management permission is reserved for the site owner role",
    });
  }
}

export function isSiteOwner(actor: AuthenticatedActor): boolean {
  return actor.roleId === SITE_OWNER_ROLE_ID
    && actor.roleLevel === SITE_OWNER_LEVEL
    && actor.permissions.has(PERMISSION_ID.ADMIN_OWNERS_MANAGE);
}
