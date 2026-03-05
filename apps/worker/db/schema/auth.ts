// Domain: Auth & Identity
// Tables: roles, role_permissions, users, user_auth_password, invite_links, discord_link_codes, sessions
// Dependencies: none (root domain)
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowUtc } from "./shared";

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    color: text("color"),
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxLevel: index("idx_roles_level").on(table.level, table.id),
  }),
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    granted: integer("granted", { mode: "boolean" }).notNull().default(true),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permission] }),
    idxPermission: index("idx_role_permissions_permission").on(table.permission),
  }),
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    role: text("role", { enum: ["admin", "moderator", "member"] }).notNull().default("member"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxDeletedActiveCreated: index("idx_users_deleted_active_created").on(
      table.deletedAt,
      table.isActive,
      table.createdAt,
      table.id,
    ),
    idxRoleActive: index("idx_users_role_active").on(table.role, table.isActive, table.deletedAt),
  }),
);

export const userAuthPassword = sqliteTable("user_auth_password", {
  userId: text("user_id").primaryKey().references(() => users.id),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  updatedAt: text("updated_at").notNull().default(nowUtc),
});

export const inviteLinks = sqliteTable(
  "invite_links",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    createdBy: text("created_by").notNull().references(() => users.id),
    maxUses: integer("max_uses").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
    revokedAt: text("revoked_at"),
  },
  (table) => ({
    idxCreatedAt: index("idx_invite_links_created").on(table.createdAt),
    idxStatus: index("idx_invite_links_status").on(table.revokedAt, table.expiresAt, table.createdAt),
  }),
);

export const discordLinkCodes = sqliteTable(
  "discord_link_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    discordId: text("discord_id").notNull(),
    code: text("code").notNull(),
    expiresAt: text("expires_at").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxUserLookup: index("idx_discord_link_codes_user_lookup").on(
      table.userId,
      table.code,
      table.used,
      table.expiresAt,
      table.createdAt,
    ),
    idxDiscordLookup: index("idx_discord_link_codes_discord_lookup").on(
      table.discordId,
      table.used,
      table.expiresAt,
      table.createdAt,
    ),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxUserExpires: index("idx_sessions_user_expires").on(table.userId, table.expiresAt),
  }),
);
