import type { Permission, User } from "@guild/shared";
import type { AdminRole } from "@guild/shared";

const ADMIN_ACCESS_PERMISSIONS: Permission[] = [
  "admin.users.view",
  "admin.invite.view",
  "admin.audit.view",
  "admin.status.view",
  "admin.roles.view",
  "admin.badges.manage",
  "admin.gameData.manage",
  "admin.storage.structure",
  "admin.storage.items",
  "admin.storage.stock",
  "admin.roles.manage",
];

export type AdminCapabilities = {
  canAccessAdmin: boolean;
  canViewUsers: boolean;
  canViewInvites: boolean;
  canViewAudit: boolean;
  canExportAudit: boolean;
  canViewRoles: boolean;
  canManageRoles: boolean;
  canViewStatus: boolean;
  canManageBadges: boolean;
  canManageGameData: boolean;
};

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
  return hasAnyPermission(roles, roleId, ADMIN_ACCESS_PERMISSIONS);
}

export function canManageRoles(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.roles.manage"]);
}

export function canViewUsers(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.users.view"]);
}

export function canViewInvites(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.invite.view"]);
}

export function canViewAudit(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.audit.view"]);
}

export function canViewRoles(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.roles.view", "admin.roles.manage"]);
}

export function canViewStatus(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.status.view"]);
}

export function canExportAudit(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.audit.export"]);
}

export function canManageBadges(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.badges.manage"]);
}

export function canManageGameData(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.gameData.manage"]);
}

export function getAdminCapabilities(roles: AdminRole[], roleId: string): AdminCapabilities {
  return {
    canAccessAdmin: canAccessAdmin(roles, roleId),
    canViewUsers: canViewUsers(roles, roleId),
    canViewInvites: canViewInvites(roles, roleId),
    canViewAudit: canViewAudit(roles, roleId),
    canExportAudit: canExportAudit(roles, roleId),
    canViewRoles: canViewRoles(roles, roleId),
    canManageRoles: canManageRoles(roles, roleId),
    canViewStatus: canViewStatus(roles, roleId),
    canManageBadges: canManageBadges(roles, roleId),
    canManageGameData: canManageGameData(roles, roleId),
  };
}

function userHasPermission(user: User | null, permission: Permission): boolean {
  return user?.permissions[permission] === true;
}

function userHasAnyPermission(user: User | null, permissions: Permission[]): boolean {
  if (!user) return false;
  return permissions.some((p) => user.permissions[p] === true);
}

export function userCanAccessAdmin(user: User | null): boolean {
  return userHasAnyPermission(user, ADMIN_ACCESS_PERMISSIONS);
}

export function userCanManageRoles(user: User | null): boolean {
  return userHasPermission(user, "admin.roles.manage");
}

export function userCanViewStatus(user: User | null): boolean {
  return userHasPermission(user, "admin.status.view");
}
