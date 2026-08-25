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
  "admin.siteConfig.manage",
  "admin.importantNotices.manage",
  "admin.classes.manage",
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
  "admin.storage.structure",
  "admin.storage.items",
  "admin.storage.stock",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Named IDs for server policies; values remain the Portal's frozen wire IDs. */
export const PERMISSION_ID = {
  ADMIN_USERS_VIEW: "admin.users.view",
  ADMIN_USERS_EDIT: "admin.users.edit",
  ADMIN_USERS_ROLE: "admin.users.role",
  ADMIN_USERS_ACTIVATE: "admin.users.activate",
  ADMIN_USERS_DELETE: "admin.users.delete",
  ADMIN_USERS_PASSWORD: "admin.users.password",
  ADMIN_INVITE_VIEW: "admin.invite.view",
  ADMIN_INVITE_MANAGE: "admin.invite.manage",
  ADMIN_AUDIT_VIEW: "admin.audit.view",
  ADMIN_AUDIT_EXPORT: "admin.audit.export",
  ADMIN_STATUS_VIEW: "admin.status.view",
  ADMIN_ANALYTICS_VIEW: "admin.analytics.view",
  ADMIN_ANALYTICS_MANAGE: "admin.analytics.manage",
  ADMIN_ROLES_VIEW: "admin.roles.view",
  ADMIN_ROLES_MANAGE: "admin.roles.manage",
  ADMIN_SITE_CONFIG_MANAGE: "admin.siteConfig.manage",
  ADMIN_IMPORTANT_NOTICES_MANAGE: "admin.importantNotices.manage",
  ADMIN_CLASSES_MANAGE: "admin.classes.manage",
  GUILD_WAR_TEAMS_EDIT: "guildwar.teams.edit",
  GUILD_WAR_HISTORY_EDIT: "guildwar.history.edit",
  EVENTS_CREATE: "events.create",
  EVENTS_EDIT: "events.edit",
  EVENTS_ARCHIVE: "events.archive",
  EVENTS_DELETE: "events.delete",
  EVENTS_TEMPLATES: "events.templates",
  ANNOUNCEMENTS_CREATE: "announcements.create",
  ANNOUNCEMENTS_EDIT: "announcements.edit",
  ANNOUNCEMENTS_ARCHIVE: "announcements.archive",
  ANNOUNCEMENTS_DELETE: "announcements.delete",
  GALLERY_UPLOAD: "gallery.upload",
  GALLERY_MANAGE: "gallery.manage",
  GALLERY_DELETE: "gallery.delete",
  WIKI_ARTICLES_CREATE: "wiki.articles.create",
  WIKI_ARTICLES_EDIT: "wiki.articles.edit",
  WIKI_ARTICLES_ARCHIVE: "wiki.articles.archive",
  WIKI_ARTICLES_DELETE: "wiki.articles.delete",
  WIKI_CATEGORIES_MANAGE: "wiki.categories.manage",
  ADMIN_BADGES_MANAGE: "admin.badges.manage",
  ADMIN_STORAGE_STRUCTURE: "admin.storage.structure",
  ADMIN_STORAGE_ITEMS: "admin.storage.items",
  ADMIN_STORAGE_STOCK: "admin.storage.stock",
} as const satisfies Record<string, Permission>;

export const DEFAULT_ROLE_ID = "member";
export const SEEDED_ROLES = [
  {
    id: "admin",
    name: "Admin",
    level: 1_000,
    color: "red",
    permissions: PERMISSIONS,
  },
  {
    id: "moderator",
    name: "Moderator",
    level: 500,
    color: "#756047",
    permissions: [
      PERMISSION_ID.ADMIN_USERS_VIEW,
      PERMISSION_ID.ADMIN_USERS_EDIT,
      PERMISSION_ID.ADMIN_INVITE_VIEW,
      PERMISSION_ID.ADMIN_AUDIT_VIEW,
      PERMISSION_ID.ADMIN_STATUS_VIEW,
      PERMISSION_ID.ADMIN_ROLES_VIEW,
      PERMISSION_ID.ADMIN_ANALYTICS_VIEW,
      PERMISSION_ID.GUILD_WAR_TEAMS_EDIT,
      PERMISSION_ID.GUILD_WAR_HISTORY_EDIT,
      PERMISSION_ID.EVENTS_CREATE,
      PERMISSION_ID.EVENTS_EDIT,
      PERMISSION_ID.EVENTS_ARCHIVE,
      PERMISSION_ID.EVENTS_DELETE,
      PERMISSION_ID.EVENTS_TEMPLATES,
      PERMISSION_ID.ANNOUNCEMENTS_CREATE,
      PERMISSION_ID.ANNOUNCEMENTS_EDIT,
      PERMISSION_ID.ANNOUNCEMENTS_ARCHIVE,
      PERMISSION_ID.ANNOUNCEMENTS_DELETE,
      PERMISSION_ID.GALLERY_UPLOAD,
      PERMISSION_ID.GALLERY_MANAGE,
      PERMISSION_ID.GALLERY_DELETE,
      PERMISSION_ID.WIKI_ARTICLES_CREATE,
      PERMISSION_ID.WIKI_ARTICLES_EDIT,
      PERMISSION_ID.WIKI_ARTICLES_ARCHIVE,
      PERMISSION_ID.WIKI_ARTICLES_DELETE,
      PERMISSION_ID.WIKI_CATEGORIES_MANAGE,
    ],
  },
  {
    id: DEFAULT_ROLE_ID,
    name: "Member",
    level: 100,
    color: "gray",
    permissions: [PERMISSION_ID.GALLERY_UPLOAD],
  },
] as const satisfies readonly {
  id: string;
  name: string;
  level: number;
  color: string;
  permissions: readonly Permission[];
}[];

export function hasAnyPermission(granted: ReadonlySet<Permission>, required: readonly Permission[]): boolean {
  return required.some((p) => granted.has(p));
}

export function permissionSetToRecord(permissions: ReadonlySet<Permission>): Record<Permission, boolean> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, permissions.has(p)])) as Record<Permission, boolean>;
}
