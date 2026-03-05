export const ROLES = ["admin", "moderator", "member"] as const;

export type Role = (typeof ROLES)[number];

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
  "admin.roles.manage",
  "guildwar.manage",
  "guildwar.history.edit",
  "events.manage",
  "announcements.manage",
  "gallery.upload",
  "wiki.edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_LEVEL: Record<Role, number> = {
  admin: 3,
  moderator: 2,
  member: 1,
};

export function hasRoleAtLeast(current: Role, required: Role): boolean {
  return ROLE_LEVEL[current] >= ROLE_LEVEL[required];
}
