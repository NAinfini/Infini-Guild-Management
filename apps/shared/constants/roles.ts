export const BUILTIN_ROLES = ["admin", "moderator", "member"] as const;

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
  "admin.badges.manage",
  "admin.gameData.manage",
  "admin.storage.structure",
  "admin.storage.items",
  "admin.storage.stock",
  "admin.storage.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const HIGH_RISK_PERMISSIONS: readonly Permission[] = [
  "admin.users.password",
  "admin.users.role",
  "admin.users.delete",
  "admin.roles.manage",
  "admin.audit.export",
] as const;

export function hasAnyPermission(granted: ReadonlySet<Permission>, required: readonly Permission[]): boolean {
  return required.some((p) => granted.has(p));
}

export function permissionSetToRecord(permissions: ReadonlySet<Permission>): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, permissions.has(p)])) as Record<Permission, boolean>;
}
