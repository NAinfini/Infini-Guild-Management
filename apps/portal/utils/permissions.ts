import type { Permission, User } from "@guild/shared";
import type { AdminRole } from "@guild/shared";

function hasAnyPermission(
  roles: AdminRole[],
  roleId: string,
  permissions: Permission[]
): boolean {
  const role = roles.find((r) => r.id === roleId);
  if (!role) return false;
  return permissions.some((p) => role.permissions[p] === true);
}

export function canAccessAdmin(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, [
    "admin.users.view",
    "admin.invite.view",
    "admin.audit.view",
    "admin.status.view",
    "admin.roles.manage",
  ]);
}

export function canManageRoles(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.roles.manage"]);
}

export function canViewStatus(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.status.view"]);
}

export function canExportAudit(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.audit.export"]);
}

export function userHasPermission(user: User | null, permission: Permission): boolean {
  return user?.permissions[permission] === true;
}

export function userHasAnyPermission(user: User | null, permissions: Permission[]): boolean {
  if (!user) return false;
  return permissions.some((p) => user.permissions[p] === true);
}

export function userCanAccessAdmin(user: User | null): boolean {
  return userHasAnyPermission(user, [
    "admin.users.view",
    "admin.invite.view",
    "admin.audit.view",
    "admin.status.view",
    "admin.roles.manage",
  ]);
}

export function userCanManageRoles(user: User | null): boolean {
  return userHasPermission(user, "admin.roles.manage");
}

export function userCanViewStatus(user: User | null): boolean {
  return userHasPermission(user, "admin.status.view");
}
