// Domain: Auth & Identity
// Tables: roles, role_permissions, users, user_auth_password, invite_links, sessions
// Dependencies: none (root domain)
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { PERMISSIONS } from "@guild/shared/constants/roles";
import { canonicalUtcDateTime, nowUtc } from "./shared";

const PERMISSION_IDS = PERMISSIONS as unknown as [string, ...string[]];
const PERMISSION_VALUES = sql.raw(PERMISSIONS.map((permission) => `'${permission}'`).join(", "));

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    color: text("color"),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_roles_level").on(table.level, table.id),
    check("roles_level_positive", sql`${table.level} >= 1`),
  ],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission", { enum: PERMISSION_IDS }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permission] }),
    index("idx_role_permissions_permission").on(table.permission),
    check("role_permissions_permission_valid", sql`${table.permission} IN (${PERMISSION_VALUES})`),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    // Drizzle's SQLite builder has no collation option, so the core SQL adds
    // ux_users_username_nocase; query with usernameEquals for matching parity.
    username: text("username").notNull(),
    role: text("role").notNull().references(() => roles.id),
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
    idNanoid: check(
      "users_id_nanoid",
      sql`length(${table.id}) = 21 AND ${table.id} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    isActiveBoolean: check("users_is_active_boolean", sql`${table.isActive} IN (0, 1)`),
  }),
);

export const userAuthPassword = sqliteTable("user_auth_password", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
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
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    maxUses: integer("max_uses").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("idx_invite_links_created").on(table.createdAt, table.id),
    index("idx_invite_links_status").on(table.revokedAt, table.expiresAt, table.createdAt),
    index("idx_invite_links_created_by").on(table.createdBy),
    index("idx_invite_links_role_id").on(table.roleId),
    check("invite_links_max_uses_positive", sql`${table.maxUses} > 0`),
    check(
      "invite_links_used_count_valid",
      sql`${table.usedCount} >= 0 AND ${table.usedCount} <= ${table.maxUses}`,
    ),
    check(
      "invite_links_times_valid",
      sql`(${table.expiresAt} IS NULL OR (${canonicalUtcDateTime(table.expiresAt)})) AND (${table.revokedAt} IS NULL OR (${canonicalUtcDateTime(table.revokedAt)}))`,
    ),
  ],
);

/**
 * Progressive login lockout state.
 *
 * Keyed on the attempted username string, NOT on users.id, and deliberately so:
 * rows are created for usernames that do not exist too, otherwise the lockout
 * response would only ever appear for real accounts and would hand an attacker
 * a username-enumeration oracle. The core SQL uses `username COLLATE NOCASE`,
 * matching usernameEquals and the users NOCASE expression index.
 *
 * Growth is bounded by pruning stale rows — see services/login-lockout.ts.
 */
export const loginFailures = sqliteTable(
  "login_failures",
  {
    username: text("username").primaryKey(),
    failCount: integer("fail_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastFailedAt: text("last_failed_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxLastFailedAt: index("idx_login_failures_last_failed_at").on(table.lastFailedAt),
    failCountNonnegative: check("login_failures_fail_count_nonnegative", sql`${table.failCount} >= 0`),
    lockedUntilValid: check(
      "login_failures_locked_until_valid",
      sql`${table.lockedUntil} IS NULL OR (${canonicalUtcDateTime(table.lockedUntil)})`,
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
    idxExpiresAt: index("idx_sessions_expires_at").on(table.expiresAt),
    idxCreatedAt: index("idx_sessions_created_at").on(table.createdAt),
    expiresAtValid: check("sessions_expires_at_valid", canonicalUtcDateTime(table.expiresAt)),
  }),
);
