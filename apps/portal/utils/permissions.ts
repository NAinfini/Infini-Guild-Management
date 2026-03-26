import type { Permission } from "@guild/shared";
import type { AdminRole } from "@guild/shared";

export function hasAnyPermission(
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
    "admin.bot.view",
    "admin.status.view",
    "admin.roles.manage",
  ]);
}

export function canManageRoles(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.roles.manage"]);
}

export function canManageBot(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.bot.manage"]);
}

export function canViewStatus(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.status.view"]);
}

export function canExportAudit(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.audit.export"]);
}
