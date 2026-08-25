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
    // Public identity only. Authentication belongs to user_credentials.login_name.
    display_name: text("display_name").notNull(),
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
    uniqueIndex("ux_users_display_name_nocase").on(sql`${table.display_name} COLLATE NOCASE`),
    index("idx_users_roster").on(table.deletedAt, table.isActive, table.createdAt, table.id),
    index("idx_users_roster_all").on(table.deletedAt, table.createdAt, table.id),
    index("idx_users_role").on(table.roleId, table.deletedAt, table.isActive),
    check("users_active_boolean", sql`${table.isActive} IN (0, 1)`),
    check("users_revision_present", sql`length(${table.revisionToken}) >= 16`),
  ],
);

export const userCredentials = sqliteTable(
  "user_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    loginName: text("login_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    temporaryPasswordExpiresAt: text("temporary_password_expires_at"),
    temporaryPasswordUsedAt: text("temporary_password_used_at"),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    authRevision: integer("auth_revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("ux_user_credentials_login_name_nocase").on(sql`${table.loginName} COLLATE NOCASE`),
  ],
);

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
    loginName: text("login_name").primaryKey(),
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
    scope: text("scope", { enum: ["normal", "password_change"] }).notNull().default("normal"),
    authRevision: integer("auth_revision").notNull().default(1),
  },
  (table) => [
    index("idx_sessions_user_created").on(table.userId, table.createdAt, table.tokenDigest),
    index("idx_sessions_expires").on(table.expiresAt, table.tokenDigest),
    index("idx_sessions_created").on(table.createdAt, table.tokenDigest),
    check("sessions_scope_valid", sql`${table.scope} IN ('normal', 'password_change')`),
  ],
);

export const externalIdentities = sqliteTable(
  "external_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "discord", "kook", "wechat"] }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    lastUsedAt: text("last_used_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_external_identities_provider_subject").on(table.provider, table.providerSubject),
    uniqueIndex("ux_external_identities_user_provider").on(table.userId, table.provider),
    index("idx_external_identities_user").on(table.userId, table.provider),
    check("external_identities_provider_valid", sql`${table.provider} IN ('google', 'discord', 'kook', 'wechat')`),
  ],
);

export const oauthChallenges = sqliteTable(
  "oauth_challenges",
  {
    stateDigest: text("state_digest").primaryKey(),
    browserBindingDigest: text("browser_binding_digest").notNull(),
    provider: text("provider", { enum: ["google", "discord", "kook", "wechat"] }).notNull(),
    purpose: text("purpose", { enum: ["login", "link"] }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    nonce: text("nonce"),
    pkceVerifier: text("pkce_verifier"),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull().default(nowUtc),
    // Link challenges are bound to the credential state that authorized them.
    authRevision: integer("auth_revision"),
  },
  (table) => [
    index("idx_oauth_challenges_expiry").on(table.expiresAt),
    check("oauth_challenges_provider_valid", sql`${table.provider} IN ('google', 'discord', 'kook', 'wechat')`),
    check("oauth_challenges_purpose_valid", sql`${table.purpose} IN ('login', 'link')`),
    check(
      "oauth_challenges_link_user",
      sql`(${table.purpose} = 'link' AND ${table.userId} IS NOT NULL) OR (${table.purpose} = 'login' AND ${table.userId} IS NULL)`,
    ),
  ],
);

export const userEmails = sqliteTable(
  "user_emails",
  {
    userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    normalizedEmail: text("normalized_email").notNull(),
    verifiedAt: text("verified_at").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_user_emails_normalized_nocase").on(sql`${table.normalizedEmail} COLLATE NOCASE`),
  ],
);

export const emailVerificationChallenges = sqliteTable(
  "email_verification_challenges",
  {
    tokenDigest: text("token_digest").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    pendingEmail: text("pending_email").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    sentCount: integer("sent_count").notNull().default(1),
    lastSentAt: text("last_sent_at").notNull().default(nowUtc),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_email_verification_challenges_user").on(table.userId, table.expiresAt),
    index("idx_email_verification_challenges_user_last_sent").on(table.userId, table.lastSentAt),
    check("email_verification_challenges_sent_count", sql`${table.sentCount} >= 1`),
  ],
);
