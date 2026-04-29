export const ROLES = ["admin", "moderator", "member"] as const;

export type BuiltinRole = (typeof ROLES)[number];
export type Role = string;
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
  "guildwar.teams.edit",
  "guildwar.teams.post",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "gallery.upload",
  "gallery.manage",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.categories.manage",
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
  "guildwar.teams.edit",
  "guildwar.teams.post",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "gallery.upload",
  "gallery.manage",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.categories.manage",
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

export function hasRoleAtLeast(current: string, required: BuiltinRole): boolean {
  const level = isBuiltinRole(current) ? ROLE_LEVEL[current] : 0;
  return level >= ROLE_LEVEL[required];
}

export function hasLevelAtLeast(currentLevel: number, required: BuiltinRole): boolean {
  return currentLevel >= ROLE_LEVEL[required];
}

export function permissionSetToRecord(permissions: ReadonlySet<Permission>): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, permissions.has(p)])) as Record<Permission, boolean>;
}
