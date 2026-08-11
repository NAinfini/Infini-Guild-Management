import {
  PERMISSIONS,
  SITE_OWNER_LEVEL,
  SITE_OWNER_ROLE_ID,
  type AdminRole,
  type Permission,
  type User,
} from "@guild/shared";

const ADMIN_ACCESS_PERMISSIONS = PERMISSIONS.filter((permission) => permission.startsWith("admin."));

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
  canManageSiteConfig: boolean;
  canManageClasses: boolean;
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

export function canManageSiteConfig(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.siteConfig.manage"]);
}

export function canManageClasses(roles: AdminRole[], roleId: string): boolean {
  return hasAnyPermission(roles, roleId, ["admin.classes.manage"]);
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
    canManageSiteConfig: canManageSiteConfig(roles, roleId),
    canManageClasses: canManageClasses(roles, roleId),
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

function isSiteOwner(user: User | null): user is User {
  return Boolean(
    user
    && user.role === SITE_OWNER_ROLE_ID
    && user.role_level === SITE_OWNER_LEVEL
    && user.permissions["admin.owners.manage"] === true,
  );
}

export function isRoleAssignableToUser(role: AdminRole, user: User | null): boolean {
  const ownerAssignment = isSiteOwner(user)
    && role.id === SITE_OWNER_ROLE_ID
    && role.level === SITE_OWNER_LEVEL;
  if (!user || (role.level >= user.role_level && !ownerAssignment)) {
    return false;
  }

  return Object.entries(role.permissions).every(([permission, granted]) =>
    !granted || user.permissions[permission as Permission] === true,
  );
}

export function canManageUserByRoleLevel(target: User, user: User | null): boolean {
  if (!user || target.id === user.id) return false;
  if (target.role_level < user.role_level) return true;
  return isSiteOwner(user)
    && target.role === SITE_OWNER_ROLE_ID
    && target.role_level === SITE_OWNER_LEVEL;
}

export function canPreviewRole(role: AdminRole, user: User | null): boolean {
  return Boolean(user && role.level <= user.role_level);
}
