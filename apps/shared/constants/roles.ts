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
  "admin.status.view",
  "admin.analytics.view",
  "admin.analytics.manage",
  "admin.roles.view",
  "admin.roles.manage",
  "guildwar.teams.edit",
  "guildwar.templates",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "announcements.delete",
  "gallery.upload",
  "gallery.manage",
  "gallery.delete",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.articles.delete",
  "wiki.categories.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const MODERATOR_DEFAULT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "admin.users.view",
  "admin.users.edit",
  "admin.invite.view",
  "admin.audit.view",
  "admin.status.view",
  "admin.analytics.view",
  "admin.roles.view",
  "guildwar.teams.edit",
  "guildwar.templates",
  "guildwar.history.edit",
  "events.create",
  "events.edit",
  "events.archive",
  "events.delete",
  "events.templates",
  "announcements.create",
  "announcements.edit",
  "announcements.archive",
  "announcements.delete",
  "gallery.upload",
  "gallery.manage",
  "gallery.delete",
  "wiki.articles.create",
  "wiki.articles.edit",
  "wiki.articles.archive",
  "wiki.articles.delete",
  "wiki.categories.manage",
]);

export const MEMBER_DEFAULT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(["gallery.upload"]);

export function isBuiltinRole(roleId: string): roleId is BuiltinRole {
  return (ROLES as readonly string[]).includes(roleId);
}

export function hasAnyPermission(granted: ReadonlySet<Permission>, required: readonly Permission[]): boolean {
  return required.some((p) => granted.has(p));
}

export function permissionSetToRecord(permissions: ReadonlySet<Permission>): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, permissions.has(p)])) as Record<Permission, boolean>;
}
