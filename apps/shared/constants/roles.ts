export const ROLES = ["admin", "moderator", "member"] as const;

export type BuiltinRole = (typeof ROLES)[number];
export type Role = BuiltinRole;
export type RoleId = string;

export const PERMISSIONS = [
  "admin.users.view",
  "admin.users.edit",
  "admin.users.role",
  "admin.users.activate",
  "admin.users.delete",
  "admin.users.password",
  "admin.invite.view",
  "admin.invite.manage",
  "admin.audit.view",
  "admin.audit.export",
  "admin.bot.view",
  "admin.bot.manage",
  "admin.status.view",
  "admin.analytics.view",
  "admin.analytics.manage",
  "admin.roles.view",
  "admin.roles.manage",
  "guildwar.manage",
  "guildwar.history.edit",
  "events.manage",
  "announcements.manage",
  "gallery.upload",
  "gallery.manage",
  "wiki.edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LEVEL: Record<BuiltinRole, number> = {
  admin: 3,
  moderator: 2,
  member: 1,
};

export const MODERATOR_DEFAULT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "admin.users.view",
  "admin.users.edit",
  "admin.invite.view",
  "admin.audit.view",
  "admin.bot.view",
  "admin.status.view",
  "admin.analytics.view",
  "admin.roles.view",
  "guildwar.manage",
  "guildwar.history.edit",
  "events.manage",
  "announcements.manage",
  "gallery.upload",
  "gallery.manage",
  "wiki.edit",
]);

export const MEMBER_DEFAULT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(["gallery.upload"]);

export function isBuiltinRole(roleId: string): roleId is BuiltinRole {
  return (ROLES as readonly string[]).includes(roleId);
}

export function roleFromLevel(level: number): BuiltinRole {
  if (level >= ROLE_LEVEL.admin) return "admin";
  if (level >= ROLE_LEVEL.moderator) return "moderator";
  return "member";
}

export function hasPermission(granted: ReadonlySet<Permission>, required: Permission): boolean {
  return granted.has(required);
}

export function hasAnyPermission(granted: ReadonlySet<Permission>, required: readonly Permission[]): boolean {
  return required.some((p) => granted.has(p));
}

export function hasRoleAtLeast(current: Role, required: Role): boolean {
  return ROLE_LEVEL[current] >= ROLE_LEVEL[required];
}
