import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { PERMISSIONS } from "@guild/shared/constants/roles";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const permissionValues = sql.raw(PERMISSIONS.map((permission) => `'${permission}'`).join(", "));
const permissionIds = PERMISSIONS as unknown as [string, ...string[]];

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    color: text("color"),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_roles_name_nocase").on(sql`${table.name} COLLATE NOCASE`),
    index("idx_roles_level").on(table.level, table.id),
    check("roles_level_valid", sql`${table.level} BETWEEN 1 AND 1000`),
    check("roles_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission", { enum: permissionIds }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permission] }),
    index("idx_role_permissions_permission").on(table.permission, table.roleId),
    check("role_permissions_permission_valid", sql`${table.permission} IN (${permissionValues})`),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    deletedAt: text("deleted_at"),
    revisionToken: text("revision_token").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    /* 最近一次成功登录的时刻。会话表留不住这个信息：会话有条数上限、过期后还会被
       清掉，翻不出「上次是什么时候来的」。空值表示建号以来一次都没登录过。
       它不参与并发校验，所以写它时不动 revision_token 和 updated_at。
       字段排在最后是因为它由 ALTER TABLE 追加，列序必须与迁移后的实际表一致。 */
    lastLoginAt: text("last_login_at"),
  },
  (table) => [
    uniqueIndex("ux_users_username_nocase").on(sql`${table.username} COLLATE NOCASE`),
    index("idx_users_roster").on(table.deletedAt, table.isActive, table.createdAt, table.id),
    index("idx_users_roster_all").on(table.deletedAt, table.createdAt, table.id),
    index("idx_users_role").on(table.roleId, table.deletedAt, table.isActive),
    check("users_active_boolean", sql`${table.isActive} IN (0, 1)`),
    check("users_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const userCredentials = sqliteTable("user_credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: text("updated_at").notNull().default(nowUtc),
});

export const inviteLinks = sqliteTable(
  "invite_links",
  {
    id: text("id").primaryKey(),
    tokenDigest: text("token_digest").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    uniqueIndex("ux_invite_links_token_digest").on(table.tokenDigest),
    index("idx_invite_links_created").on(table.createdAt, table.id),
    index("idx_invite_links_status").on(table.revokedAt, table.expiresAt, table.usedCount, table.maxUses),
    index("idx_invite_links_role").on(table.roleId),
    check("invite_links_max_uses_positive", sql`${table.maxUses} > 0`),
    check(
      "invite_links_used_count_valid",
      sql`${table.usedCount} >= 0 AND ${table.usedCount} <= ${table.maxUses}`,
    ),
  ],
);

export const loginFailures = sqliteTable(
  "login_failures",
  {
    username: text("username").primaryKey(),
    failCount: integer("fail_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastFailedAt: text("last_failed_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_login_failures_last_failed").on(table.lastFailedAt),
    check("login_failures_count_nonnegative", sql`${table.failCount} >= 0`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenDigest: text("token_digest").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_sessions_user_created").on(table.userId, table.createdAt, table.tokenDigest),
    index("idx_sessions_expires").on(table.expiresAt, table.tokenDigest),
    index("idx_sessions_created").on(table.createdAt, table.tokenDigest),
  ],
);
