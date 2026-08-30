import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql as drizzleSql,
} from "drizzle-orm";
import { PERMISSIONS, PERMISSION_ID, type Permission } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
import type {
  AuthStore,
  AuthUserRecord,
  CredentialRecord,
  InvitePage,
  InviteRecord,
  InviteStats,
  LoginAccountRecord,
  ManagedUserTarget,
  RoleRecord,
  SessionAuthorizationRecord,
} from "@guild/server/modules/auth";
import type { AuditEventWrite } from "@guild/server/modules/audit";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { inviteLinks, rolePermissions, roles, sessions, userCredentials, users } from "../schema/auth.js";
import { auditInsertStatement } from "./audit-statement.js";
import {
  deleteSessionsAfterMutation,
  managedTargetSnapshot,
  permissionSnapshot,
  ROLE_SNAPSHOT_MATCH,
  TARGET_SNAPSHOT_MATCH,
  targetSnapshotCte,
} from "./managed-user-mutation.js";
import { returnedRowCount, returnedRows } from "./sql-result.js";

type AuthSchema = {
  roles: typeof roles;
  rolePermissions: typeof rolePermissions;
  users: typeof users;
  userCredentials: typeof userCredentials;
  inviteLinks: typeof inviteLinks;
  sessions: typeof sessions;
};

const permissionIds = new Set<string>(PERMISSIONS);

type RoleSnapshotFields = Readonly<{
  id: string;
  name: string;
  level: number;
  color: string | null;
  revisionToken: string;
  createdAt: string;
  updatedAt: string;
}>;

function toPermissionSet(rows: readonly Readonly<{ permission: string | null }>[]): ReadonlySet<Permission> {
  return new Set(rows
    .map((row) => row.permission)
    .filter((permission): permission is Permission => permission !== null && permissionIds.has(permission)));
}

function roleRecordFromSnapshot(
  role: RoleSnapshotFields,
  permissions: ReadonlySet<Permission>,
  assignedUserCount: number,
): RoleRecord {
  return {
    ...role,
    permissions,
    assignedUserCount,
  };
}

type UserPermissionRow = Readonly<{
  id: string;
  displayName: string;
  roleId: string;
  roleName: string;
  roleColor: string | null;
  roleLevel: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  revisionToken: string;
  permission: string | null;
}>;

function userFromRows(rows: readonly UserPermissionRow[]): AuthUserRecord | null {
  const first = rows[0];
  if (!first) return null;
  return {
    id: first.id,
    displayName: first.displayName,
    roleId: first.roleId,
    roleName: first.roleName,
    roleColor: first.roleColor,
    roleLevel: first.roleLevel,
    permissions: toPermissionSet(rows),
    isActive: first.isActive,
    deletedAt: first.deletedAt,
    revisionToken: first.revisionToken,
    createdAt: first.createdAt,
    updatedAt: first.updatedAt,
    lastLoginAt: first.lastLoginAt,
  };
}

const userColumns = {
  id: users.id,
  displayName: users.display_name,
  roleId: users.roleId,
  roleName: roles.name,
  roleColor: roles.color,
  roleLevel: roles.level,
  isActive: users.isActive,
  deletedAt: users.deletedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  lastLoginAt: users.lastLoginAt,
  revisionToken: users.revisionToken,
  permission: rolePermissions.permission,
} as const;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
}

/* 签发会话和带着 cookie 回访都记「最近登录」，语句只此一条。刻意不动 updated_at /
   revision_token：那两个字段是资料修改和乐观并发用的，登录一次就把全站的成员 ETag
   冲掉不值当。 */
function touchLastLogin(userId: string, at: string): SqlBatchStatement {
  return run("UPDATE users SET last_login_at = ? WHERE id = ?", [at, userId]);
}

function returning(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "all", columns: ["affected"], sql: `${sql} RETURNING 1 AS affected`, params };
}

function roleSnapshotStatements(roleId: string, revisionToken?: string): SqlBatchStatement[] {
  const revisionGuard = revisionToken === undefined ? "" : " AND revision_token = ?";
  return [
    {
      method: "get",
      columns: ["id", "name", "level", "color", "revision_token", "created_at", "updated_at"],
      sql: `SELECT id, name, level, color, revision_token, created_at, updated_at
        FROM roles WHERE id = ?${revisionGuard}`,
      params: [roleId, ...(revisionToken === undefined ? [] : [revisionToken])],
    },
    {
      method: "all",
      columns: ["permission"],
      sql: "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission",
      params: [roleId],
    },
    {
      method: "get",
      columns: ["assigned_user_count"],
      sql: "SELECT count(*) AS assigned_user_count FROM users WHERE role_id = ? AND deleted_at IS NULL",
      params: [roleId],
    },
  ];
}

function roleSnapshotFromResults(results: readonly SqlResult[]): RoleRecord | null {
  const [roleResult, permissionsResult, countResult] = results;
  if (!roleResult || !permissionsResult || !countResult) throw new Error("Missing role snapshot query result");
  const row = returnedRows(roleResult)[0];
  if (!row) return null;
  const [id, name, level, color, revisionToken, createdAt, updatedAt] = row;
  if (
    typeof id !== "string" || typeof name !== "string" || typeof level !== "number"
    || (color !== null && typeof color !== "string") || typeof revisionToken !== "string"
    || typeof createdAt !== "string" || typeof updatedAt !== "string"
  ) throw new Error("Invalid role snapshot row");
  const count = returnedRows(countResult)[0]?.[0];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Invalid role snapshot assignment count");
  }
  const permissions = new Set<Permission>();
  for (const permissionRow of returnedRows(permissionsResult)) {
    const permission = permissionRow[0];
    if (typeof permission !== "string") throw new Error("Invalid role snapshot permission");
    if (permissionIds.has(permission)) permissions.add(permission as Permission);
  }
  return roleRecordFromSnapshot(
    { id, name, level, color, revisionToken, createdAt, updatedAt },
    permissions,
    count,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}

function isLastRoleManagerViolation(error: unknown): boolean {
  return error instanceof Error && /last role manager required/i.test(error.message);
}

export class SqliteAuthStore implements AuthStore {
  constructor(
    private readonly db: AppDatabase<AuthSchema>,
    private readonly executor: SqlExecutor,
  ) {}

  async findLoginAccount(normalizedLoginName: string): Promise<LoginAccountRecord | null> {
    const rows = await this.db.select({
      ...userColumns,
      loginName: userCredentials.loginName,
      passwordHash: userCredentials.passwordHash,
      authRevision: userCredentials.authRevision,
      temporaryPasswordExpiresAt: userCredentials.temporaryPasswordExpiresAt,
      temporaryPasswordUsedAt: userCredentials.temporaryPasswordUsedAt,
    })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(userCredentials, eq(users.id, userCredentials.userId))
      .leftJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId))
      .where(drizzleSql`${userCredentials.loginName} COLLATE NOCASE = ${normalizedLoginName}`);
    const user = userFromRows(rows);
    return user ? {
      ...user,
      loginName: rows[0]!.loginName,
      passwordHash: rows[0]!.passwordHash,
      authRevision: rows[0]!.authRevision,
      temporaryPasswordExpiresAt: rows[0]!.temporaryPasswordExpiresAt,
      temporaryPasswordUsedAt: rows[0]!.temporaryPasswordUsedAt,
    } : null;
  }

  async findCredentialRecord(userId: string): Promise<CredentialRecord | null> {
    const row = await this.db.select({
      loginName: userCredentials.loginName,
      passwordHash: userCredentials.passwordHash,
      authRevision: userCredentials.authRevision,
    }).from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1);
    return row[0] ?? null;
  }

  async findLoginName(userId: string): Promise<string | null> {
    const row = await this.db.select({ loginName: userCredentials.loginName })
      .from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1);
    return row[0]?.loginName ?? null;
  }

  async findUser(userId: string): Promise<AuthUserRecord | null> {
    const rows = await this.db.select(userColumns).from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId))
      .where(eq(users.id, userId));
    return userFromRows(rows);
  }

  async findSessionAuthorization(tokenDigest: string): Promise<SessionAuthorizationRecord | null> {
    const rows = await this.db.select({
      ...userColumns,
      tokenDigest: sessions.tokenDigest,
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      sessionScope: sessions.scope,
    }).from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(userCredentials, eq(users.id, userCredentials.userId))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId))
      .where(and(eq(sessions.tokenDigest, tokenDigest), eq(sessions.authRevision, userCredentials.authRevision)));
    const user = userFromRows(rows);
    const first = rows[0];
    return user && first ? {
      ...user,
      tokenDigest: first.tokenDigest,
      expiresAt: first.expiresAt,
      sessionCreatedAt: first.sessionCreatedAt,
      sessionScope: first.sessionScope,
    } : null;
  }

  async findSessionAuthorizations(
    tokenDigests: readonly string[],
  ): Promise<ReadonlyMap<string, SessionAuthorizationRecord>> {
    const uniqueDigests = [...new Set(tokenDigests)];
    if (
      uniqueDigests.length !== tokenDigests.length
      || uniqueDigests.length > LIMITS.websocket.maxConnections
      || uniqueDigests.some((digest) => !digest.trim() || digest.length > 256)
    ) {
      throw new TypeError("Session authorization digests must be unique and bounded");
    }
    if (uniqueDigests.length === 0) return new Map();
    const rows = await this.db.select({
      ...userColumns,
      tokenDigest: sessions.tokenDigest,
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      sessionScope: sessions.scope,
    }).from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(userCredentials, eq(users.id, userCredentials.userId))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId))
      .where(and(
        drizzleSql`${sessions.tokenDigest} IN (
          SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(uniqueDigests)})
        )`,
        eq(sessions.authRevision, userCredentials.authRevision),
      ));
    const rowsByDigest = new Map<string, typeof rows>();
    for (const row of rows) {
      const grouped = rowsByDigest.get(row.tokenDigest) ?? [];
      grouped.push(row);
      rowsByDigest.set(row.tokenDigest, grouped);
    }
    const records = new Map<string, SessionAuthorizationRecord>();
    for (const [tokenDigest, grouped] of rowsByDigest) {
      const user = userFromRows(grouped);
      const first = grouped[0];
      if (!user || !first) continue;
      records.set(tokenDigest, {
        ...user,
        tokenDigest,
        expiresAt: first.expiresAt,
        sessionCreatedAt: first.sessionCreatedAt,
        sessionScope: first.sessionScope,
      });
    }
    return records;
  }

  async rehashPassword(input: Parameters<AuthStore["rehashPassword"]>[0]): Promise<boolean> {
    const result = await this.executor.execute(returning(
      `UPDATE user_credentials SET password_hash = ?, updated_at = ?
       WHERE user_id = ? AND password_hash = ? AND auth_revision = ?`,
      [input.passwordHash, input.now, input.userId, input.expectedPasswordHash, input.expectedAuthRevision],
    ));
    return returnedRowCount(result) === 1;
  }

  async openUserSession(input: Readonly<{
    userId: string;
    tokenDigest: string;
    expiresAt: string;
    createdAt: string;
    maximumSessions: number;
    scope?: "normal" | "password_change";
    expectedAuthRevision: number;
  }>): Promise<boolean> {
    const openedSession = {
      sql: "SELECT 1 FROM sessions WHERE token_digest = ? AND user_id = ? AND auth_revision = ?",
      params: [input.tokenDigest, input.userId, input.expectedAuthRevision] as const,
    };
    const results = await this.executor.batch([
      returning(
        `INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope, auth_revision)
         SELECT ?, ?, ?, ?, ?, auth_revision FROM user_credentials
         WHERE user_id = ? AND auth_revision = ?`,
        [
          input.tokenDigest,
          input.userId,
          input.expiresAt,
          input.createdAt,
          input.scope ?? "normal",
          input.userId,
          input.expectedAuthRevision,
        ],
      ),
      run(`DELETE FROM sessions WHERE user_id = ? AND expires_at <= ? AND EXISTS (${openedSession.sql})`, [
        input.userId,
        input.createdAt,
        ...openedSession.params,
      ]),
      run(
        `DELETE FROM sessions WHERE token_digest IN (
          SELECT token_digest FROM sessions WHERE user_id = ?
          ORDER BY created_at DESC, token_digest DESC LIMIT -1 OFFSET ?
        ) AND EXISTS (${openedSession.sql})`,
        [input.userId, input.maximumSessions - 1, ...openedSession.params],
      ),
      /* 「发出会话」就是「这个人登录了」，两件事写在同一个批里，不会出现有会话却没
         登录时刻的中间态。 */
      run(`UPDATE users SET last_login_at = ? WHERE id = ? AND EXISTS (${openedSession.sql})`, [
        input.createdAt,
        input.userId,
        ...openedSession.params,
      ]),
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async recordLastLogin(userId: string, at: string): Promise<void> {
    await this.executor.execute(touchLastLogin(userId, at));
  }

  async renewSession(tokenDigest: string, expiresAt: string): Promise<void> {
    await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.tokenDigest, tokenDigest));
  }

  async deleteSession(tokenDigest: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenDigest, tokenDigest));
  }

  async deleteSessionsForUsers(userIds: readonly string[]): Promise<void> {
    if (userIds.length > 0) await this.db.delete(sessions).where(inArray(sessions.userId, [...userIds]));
  }

  async findActiveInvite(code: string, now: string): Promise<InviteRecord | null> {
    const rows = await this.db.select({
      id: inviteLinks.id,
      code: inviteLinks.code,
      createdBy: inviteLinks.createdBy,
      roleId: inviteLinks.roleId,
      roleName: roles.name,
      roleColor: roles.color,
      roleLevel: roles.level,
      maxUses: inviteLinks.maxUses,
      usedCount: inviteLinks.usedCount,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
      revokedAt: inviteLinks.revokedAt,
    }).from(inviteLinks).innerJoin(roles, eq(inviteLinks.roleId, roles.id)).where(and(
      eq(inviteLinks.code, code),
      isNull(inviteLinks.revokedAt),
      lt(inviteLinks.usedCount, inviteLinks.maxUses),
      or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, now)),
    )).limit(1);
    return rows[0] ?? null;
  }

  async changeOwnPassword(input: Parameters<AuthStore["changeOwnPassword"]>[0]): Promise<boolean> {
    const completedAudit = {
      sql: "SELECT 1 FROM audit_log WHERE id = ?",
      params: [input.audit.eventId] as const,
    };
    const results = await this.executor.batch([
      returning(
        `UPDATE user_credentials SET password_hash = ?, auth_revision = auth_revision + 1, updated_at = ?
         WHERE user_id = ? AND auth_revision = ?`,
        [input.passwordHash, input.now, input.userId, input.expectedAuthRevision],
      ),
      auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      run(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (${completedAudit.sql})`, [
        input.userId,
        ...completedAudit.params,
      ]),
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async changeOwnLoginName(
    input: Parameters<AuthStore["changeOwnLoginName"]>[0],
  ): Promise<"updated" | "login_name_taken" | "invalid"> {
    try {
      const completedAudit = {
        sql: "SELECT 1 FROM audit_log WHERE id = ?",
        params: [input.audit.eventId] as const,
      };
      const results = await this.executor.batch([
        returning(
          `UPDATE user_credentials SET login_name = ?, auth_revision = auth_revision + 1, updated_at = ?
           WHERE user_id = ? AND auth_revision = ?`,
          [input.loginName, input.now, input.userId, input.expectedAuthRevision],
        ),
        auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
        run(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (${completedAudit.sql})`, [
          input.userId,
          ...completedAudit.params,
        ]),
      ]);
      return returnedRowCount(results[0]) === 1 ? "updated" : "invalid";
    } catch (error) {
      if (isUniqueViolation(error)) return "login_name_taken";
      throw error;
    }
  }

  async setTemporaryPassword(
    input: Parameters<AuthStore["setTemporaryPassword"]>[0],
  ): Promise<"updated" | "login_name_taken" | "conflict"> {
    try {
      const snapshot = targetSnapshotCte([input.target]);
      const completedAudit = {
        sql: "SELECT 1 FROM audit_log WHERE id = ?",
        params: [input.audit.eventId] as const,
      };
      const results = await this.executor.batch([
        returning(
          `${snapshot.sql}
           UPDATE user_credentials SET login_name = ?, password_hash = ?, temporary_password_expires_at = ?,
              temporary_password_used_at = NULL, auth_revision = auth_revision + 1, updated_at = ?
              WHERE user_id = ? AND login_name = ? AND auth_revision = ? AND ${TARGET_SNAPSHOT_MATCH}
                AND EXISTS (
                  SELECT 1 FROM user_credentials WHERE user_id = ? AND auth_revision = ?
                )`,
          [
            ...snapshot.params,
            input.temporaryLoginName, input.passwordHash, input.expiresAt, input.now,
            input.target.id, input.target.loginName, input.target.authRevision, managedTargetSnapshot([input.target]),
            input.actorUserId, input.expectedActorAuthRevision,
          ],
        ),
        auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
        run(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (${completedAudit.sql})`, [
          input.target.id,
          ...completedAudit.params,
        ]),
        run(`DELETE FROM external_identities WHERE user_id = ? AND EXISTS (${completedAudit.sql})`, [
          input.target.id,
          ...completedAudit.params,
        ]),
        run(`DELETE FROM oauth_challenges WHERE user_id = ? AND purpose = 'link'
          AND EXISTS (${completedAudit.sql})`, [
          input.target.id,
          ...completedAudit.params,
        ]),
      ]);
      return returnedRowCount(results[0]) === 1 ? "updated" : "conflict";
    } catch (error) {
      if (isUniqueViolation(error)) return "login_name_taken";
      throw error;
    }
  }

  async consumeTemporaryPasswordAndOpenSession(
    input: Parameters<AuthStore["consumeTemporaryPasswordAndOpenSession"]>[0],
  ): Promise<boolean> {
    const openedSession = {
      sql: "SELECT 1 FROM sessions WHERE token_digest = ? AND user_id = ? AND scope = 'password_change' AND auth_revision = ?",
      params: [input.tokenDigest, input.userId, input.authRevision] as const,
    };
    const results = await this.executor.batch([
      returning(
         `UPDATE user_credentials SET temporary_password_used_at = ?
          WHERE user_id = ? AND password_hash = ? AND temporary_password_used_at IS NULL
            AND temporary_password_expires_at > ? AND auth_revision = ?`,
         [input.now, input.userId, input.passwordHash, input.now, input.authRevision],
      ),
      run(
         `INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope, auth_revision)
          SELECT ?, ?, ?, ?, 'password_change', auth_revision FROM user_credentials
          WHERE user_id = ? AND auth_revision = ? AND changes() = 1`,
         [input.tokenDigest, input.userId, input.expiresAt, input.now, input.userId, input.authRevision],
      ),
      run(`DELETE FROM sessions
        WHERE user_id = ? AND token_digest <> ? AND expires_at <= ? AND EXISTS (${openedSession.sql})`, [
        input.userId,
        input.tokenDigest,
        input.now,
        ...openedSession.params,
      ]),
      run(
        `DELETE FROM sessions WHERE token_digest IN (
          SELECT token_digest FROM sessions
          WHERE user_id = ? AND token_digest <> ?
          ORDER BY created_at DESC, token_digest DESC LIMIT -1 OFFSET ?
        ) AND EXISTS (${openedSession.sql})`,
        [input.userId, input.tokenDigest, input.maximumSessions - 1, ...openedSession.params],
      ),
      run(`UPDATE users SET last_login_at = ? WHERE id = ? AND EXISTS (${openedSession.sql})`, [
        input.now,
        input.userId,
        ...openedSession.params,
      ]),
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async completeTemporaryPasswordAndOpenSession(
    input: Parameters<AuthStore["completeTemporaryPasswordAndOpenSession"]>[0],
  ): Promise<"completed" | "invalid" | "login_name_taken"> {
    try {
      const openedSession = {
        sql: "SELECT 1 FROM sessions WHERE token_digest = ? AND user_id = ? AND scope = 'normal' AND auth_revision = ?",
        params: [input.tokenDigest, input.userId, input.authRevision + 1] as const,
      };
      const results = await this.executor.batch([
        returning(
          `UPDATE user_credentials SET login_name = ?, password_hash = ?, temporary_password_expires_at = NULL,
              temporary_password_used_at = NULL, auth_revision = auth_revision + 1, updated_at = ?
            WHERE user_id = ? AND temporary_password_used_at IS NOT NULL
              AND temporary_password_expires_at > ?
              AND auth_revision = ?
              AND EXISTS (
                SELECT 1 FROM sessions
                WHERE token_digest = ? AND user_id = ? AND scope = 'password_change' AND auth_revision = ? AND expires_at > ?
              )`,
          [
            input.loginName,
            input.passwordHash,
            input.now,
            input.userId,
            input.now,
            input.authRevision,
            input.restrictedSessionTokenDigest,
            input.userId,
            input.authRevision,
            input.now,
          ],
        ),
        run(
          `INSERT INTO sessions (token_digest, user_id, expires_at, created_at, scope, auth_revision)
           SELECT ?, ?, ?, ?, 'normal', auth_revision FROM user_credentials
           WHERE user_id = ? AND auth_revision = ? AND changes() = 1`,
          [input.tokenDigest, input.userId, input.expiresAt, input.now, input.userId, input.authRevision + 1],
        ),
        run(`DELETE FROM sessions
          WHERE user_id = ? AND token_digest <> ? AND EXISTS (${openedSession.sql})`, [
          input.userId,
          input.tokenDigest,
          ...openedSession.params,
        ]),
        run(`UPDATE users SET last_login_at = ? WHERE id = ? AND EXISTS (${openedSession.sql})`, [
          input.now,
          input.userId,
          ...openedSession.params,
        ]),
        auditInsertStatement(input.audit, openedSession),
      ]);
      return returnedRowCount(results[0]) === 1 ? "completed" : "invalid";
    } catch (error) {
      if (isUniqueViolation(error)) return "login_name_taken";
      throw error;
    }
  }

  async listInvites(input: Parameters<AuthStore["listInvites"]>[0]): Promise<InvitePage> {
    const filters = input.visibility === "revoked"
      ? [isNotNull(inviteLinks.revokedAt)]
      : input.visibility === "expired"
        ? [isNull(inviteLinks.revokedAt), or(
            and(isNotNull(inviteLinks.expiresAt), lte(inviteLinks.expiresAt, input.now)),
            gte(inviteLinks.usedCount, inviteLinks.maxUses),
          )!]
        : [isNull(inviteLinks.revokedAt), or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, input.now))!, lt(inviteLinks.usedCount, inviteLinks.maxUses)];
    if (input.search) {
      const escaped = input.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const pattern = `%${escaped}%`;
      filters.push(or(
        drizzleSql`lower(${inviteLinks.code}) LIKE ${pattern} ESCAPE '\\'`,
        drizzleSql`lower(${inviteLinks.id}) LIKE ${pattern} ESCAPE '\\'`,
        drizzleSql`lower(${inviteLinks.createdAt}) LIKE ${pattern} ESCAPE '\\'`,
        drizzleSql`lower(${inviteLinks.expiresAt}) LIKE ${pattern} ESCAPE '\\'`,
      )!);
    }
    const base = and(...filters);
    const where = input.cursor ? and(base, or(
      lt(inviteLinks.createdAt, input.cursor.createdAt),
      and(eq(inviteLinks.createdAt, input.cursor.createdAt), lt(inviteLinks.id, input.cursor.id)),
    )) : base;
    const rows = await this.db.select({
      id: inviteLinks.id,
      code: inviteLinks.code,
      createdBy: inviteLinks.createdBy,
      roleId: inviteLinks.roleId,
      roleName: roles.name,
      roleColor: roles.color,
      roleLevel: roles.level,
      maxUses: inviteLinks.maxUses,
      usedCount: inviteLinks.usedCount,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
      revokedAt: inviteLinks.revokedAt,
    }).from(inviteLinks).innerJoin(roles, eq(inviteLinks.roleId, roles.id))
      .where(where).orderBy(desc(inviteLinks.createdAt), desc(inviteLinks.id)).limit(input.limit + 1);
    const totals = await this.db.select({ value: count() }).from(inviteLinks).where(base);
    const data = rows.slice(0, input.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async getInviteStats(now: string): Promise<InviteStats> {
    const rows = await this.db.select({
      total: count(),
      active: drizzleSql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is null and (${inviteLinks.expiresAt} is null or ${inviteLinks.expiresAt} > ${now}) and ${inviteLinks.usedCount} < ${inviteLinks.maxUses} then 1 else 0 end), 0)`,
      revoked: drizzleSql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is not null then 1 else 0 end), 0)`,
      expired: drizzleSql<number>`coalesce(sum(case when ${inviteLinks.revokedAt} is null and ((${inviteLinks.expiresAt} is not null and ${inviteLinks.expiresAt} <= ${now}) or ${inviteLinks.usedCount} >= ${inviteLinks.maxUses}) then 1 else 0 end), 0)`,
    }).from(inviteLinks);
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      revoked: Number(row?.revoked ?? 0),
      expired: Number(row?.expired ?? 0),
    };
  }

  async createInvite(input: Parameters<AuthStore["createInvite"]>[0], audit: AuditEventWrite): Promise<InviteRecord> {
    await this.executor.batch([
      run(
        `INSERT INTO invite_links (id, code, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
        [input.id, input.code, input.createdBy, input.roleId, input.maxUses, input.expiresAt, input.now],
      ),
      auditInsertStatement(audit),
    ]);
    const created = await this.findInvite(input.id);
    if (!created) throw new Error("Created invite is missing");
    return created;
  }

  async revokeInvite(id: string, now: string, audit: AuditEventWrite): Promise<boolean> {
    const results = await this.executor.batch([
      returning("UPDATE invite_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, id]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    return returnedRowCount(results[0]) > 0;
  }

  async deleteInvite(id: string, audit: AuditEventWrite): Promise<boolean> {
    const results = await this.executor.batch([
      returning("DELETE FROM invite_links WHERE id = ?", [id]),
      auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
    ]);
    return returnedRowCount(results[0]) > 0;
  }

  async findManagedUsers(userIds: readonly string[]): Promise<readonly ManagedUserTarget[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db.select({
      id: users.id,
      displayName: users.display_name,
      loginName: userCredentials.loginName,
      authRevision: userCredentials.authRevision,
      roleId: users.roleId,
      roleLevel: roles.level,
      permission: rolePermissions.permission,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      revisionToken: users.revisionToken,
      roleRevisionToken: roles.revisionToken,
    }).from(users).innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(userCredentials, eq(users.id, userCredentials.userId))
      .leftJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId))
      .where(inArray(users.id, [...userIds]));
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
    return [...grouped.values()].map((group) => {
      const first = group[0]!;
      return {
        id: first.id,
        displayName: first.displayName,
        loginName: first.loginName,
        authRevision: first.authRevision,
        roleId: first.roleId,
        roleLevel: first.roleLevel,
        rolePermissions: toPermissionSet(group),
        revisionToken: first.revisionToken,
        roleRevisionToken: first.roleRevisionToken,
        isActive: first.isActive,
        deletedAt: first.deletedAt,
      };
    });
  }

  countActiveRoleManagers(): Promise<number> {
    return this.countRoleManagers();
  }

  countActiveRoleManagersAmong(userIds: readonly string[]): Promise<number> {
    return userIds.length === 0 ? Promise.resolve(0) : this.countRoleManagers(inArray(users.id, [...userIds]));
  }

  async setUsersRole(input: Parameters<AuthStore["setUsersRole"]>[0], audit: AuditEventWrite) {
    const { targets, destinationRole } = input;
    const snapshot = targetSnapshotCte(targets);
    try {
      const results = await this.executor.batch([
        returning(
          `${snapshot.sql}
           UPDATE users SET role_id = ?, revision_token = ?, updated_at = ?
           WHERE id IN (SELECT id FROM target_snapshot)
             AND ${TARGET_SNAPSHOT_MATCH}
             AND ${ROLE_SNAPSHOT_MATCH}`,
          [
            ...snapshot.params, destinationRole.id, audit.eventId, input.now,
            managedTargetSnapshot(targets), destinationRole.id, destinationRole.revisionToken,
            destinationRole.level, permissionSnapshot(destinationRole.permissions),
          ],
        ),
        auditInsertStatement(audit, { sql: `SELECT 1 WHERE changes() = ${targets.length}` }),
        deleteSessionsAfterMutation(targets, audit.eventId),
      ]);
      return returnedRowCount(results[0]) === targets.length ? "updated" as const : "conflict" as const;
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return "last_role_manager" as const;
      throw error;
    }
  }

  async setUsersActive(input: Parameters<AuthStore["setUsersActive"]>[0], audit: AuditEventWrite) {
    const snapshot = targetSnapshotCte(input.targets);
    try {
      const results = await this.executor.batch([
        returning(
          `${snapshot.sql}
           UPDATE users SET is_active = ?, deleted_at = CASE WHEN ? = 1 THEN NULL ELSE deleted_at END,
             revision_token = ?, updated_at = ?
           WHERE id IN (SELECT id FROM target_snapshot) AND ${TARGET_SNAPSHOT_MATCH}`,
          [...snapshot.params, input.active ? 1 : 0, input.active ? 1 : 0, audit.eventId, input.now, managedTargetSnapshot(input.targets)],
        ),
        auditInsertStatement(audit, { sql: `SELECT 1 WHERE changes() = ${input.targets.length}` }),
        ...(!input.active ? [deleteSessionsAfterMutation(input.targets, audit.eventId)] : []),
      ]);
      return returnedRowCount(results[0]) === input.targets.length ? "updated" as const : "conflict" as const;
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return "last_role_manager" as const;
      throw error;
    }
  }

  async softDeleteUsers(input: Parameters<AuthStore["softDeleteUsers"]>[0], audit: AuditEventWrite) {
    const snapshot = targetSnapshotCte(input.targets);
    try {
      const results = await this.executor.batch([
        returning(
          `${snapshot.sql}
           UPDATE users SET is_active = 0, deleted_at = ?, revision_token = ?, updated_at = ?
           WHERE id IN (SELECT id FROM target_snapshot) AND ${TARGET_SNAPSHOT_MATCH}`,
          [...snapshot.params, input.now, audit.eventId, input.now, managedTargetSnapshot(input.targets)],
        ),
        auditInsertStatement(audit, { sql: `SELECT 1 WHERE changes() = ${input.targets.length}` }),
        deleteSessionsAfterMutation(input.targets, audit.eventId),
      ]);
      return returnedRowCount(results[0]) === input.targets.length ? "updated" as const : "conflict" as const;
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return "last_role_manager" as const;
      throw error;
    }
  }

  async listRoles(): Promise<readonly RoleRecord[]> {
    const roleRows = await this.db.select().from(roles)
      .orderBy(desc(roles.level), asc(roles.name))
      .limit(LIMITS.content.roleCatalogSize.max + 1);
    if (roleRows.length > LIMITS.content.roleCatalogSize.max) {
      throw new Error("Role catalog exceeds its hard limit");
    }
    if (roleRows.length === 0) return [];
    const roleIds = roleRows.map((role) => role.id);
    const [permissionRows, assignedRows] = await Promise.all([
      this.db.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds)),
      this.db.select({ roleId: users.roleId, value: count() })
        .from(users)
        .where(and(inArray(users.roleId, roleIds), isNull(users.deletedAt)))
        .groupBy(users.roleId),
    ]);
    const permissionMap = new Map<string, Set<Permission>>();
    for (const row of permissionRows) {
      if (!permissionIds.has(row.permission)) continue;
      const values = permissionMap.get(row.roleId) ?? new Set<Permission>();
      values.add(row.permission as Permission);
      permissionMap.set(row.roleId, values);
    }
    const assignedMap = new Map(assignedRows.map((row) => [row.roleId, Number(row.value)]));
    return roleRows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      color: row.color,
      permissions: permissionMap.get(row.id) ?? new Set(),
      assignedUserCount: assignedMap.get(row.id) ?? 0,
      revisionToken: row.revisionToken,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async findRole(roleId: string): Promise<RoleRecord | null> {
    return roleSnapshotFromResults(await Promise.all(
      roleSnapshotStatements(roleId).map((statement) => this.executor.execute(statement)),
    ));
  }

  async createRole(input: Parameters<AuthStore["createRole"]>[0], audit: AuditEventWrite): ReturnType<AuthStore["createRole"]> {
    try {
      const statements: SqlBatchStatement[] = [
        {
          method: "all",
          columns: ["affected"],
          sql: `INSERT INTO roles (id, name, level, color, revision_token, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM roles) < ?
            RETURNING 1 AS affected`,
          params: [
            input.id, input.name, input.level, input.color, audit.eventId, input.now, input.now,
            LIMITS.content.roleCatalogSize.max,
          ],
        },
        run(
          `INSERT INTO role_permissions (role_id, permission)
           SELECT ?, CAST(value AS TEXT) FROM json_each(?)
           WHERE EXISTS (SELECT 1 FROM roles WHERE id = ? AND revision_token = ?)`,
          [input.id, JSON.stringify(input.permissions), input.id, audit.eventId],
        ),
        auditInsertStatement(audit, {
          sql: "SELECT 1 FROM roles WHERE id = ? AND revision_token = ?",
          params: [input.id, audit.eventId],
        }),
      ];
      const snapshotOffset = statements.length;
      statements.push(...roleSnapshotStatements(input.id, audit.eventId));
      const results = await this.executor.batch(statements);
      if (returnedRowCount(results[0]) !== 1) return { status: "conflict" };
      const role = roleSnapshotFromResults(results.slice(snapshotOffset));
      if (!role) throw new Error("Created role snapshot is missing");
      return { status: "created", role };
    } catch (error) {
      if (isUniqueViolation(error)) return { status: "conflict" };
      throw error;
    }
  }

  async updateRole(input: Parameters<AuthStore["updateRole"]>[0], audit: AuditEventWrite) {
    const assignments = ["updated_at = ?", "revision_token = ?"];
    const params: SqlValue[] = [input.now, audit.eventId];
    if (input.name !== undefined) { assignments.push("name = ?"); params.push(input.name); }
    if (input.level !== undefined) { assignments.push("level = ?"); params.push(input.level); }
    if (input.color !== undefined) { assignments.push("color = ?"); params.push(input.color); }
    params.push(input.id, input.expectedRevisionToken, permissionSnapshot(input.expectedPermissions));
    const statements: SqlBatchStatement[] = [returning(
      `UPDATE roles SET ${assignments.join(", ")}
       WHERE id = ? AND revision_token = ? AND COALESCE((
         SELECT group_concat(permission, ',') FROM (
           SELECT permission FROM role_permissions WHERE role_id = roles.id ORDER BY permission
         )
       ), '') = ?`,
      params,
    ), auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" })];
    if (input.permissionDelta.remove.length > 0) {
      statements.push(run(
        `DELETE FROM role_permissions WHERE role_id = ? AND permission IN (${placeholders(input.permissionDelta.remove)})
           AND EXISTS (SELECT 1 FROM roles WHERE id = ? AND revision_token = ?)`,
        [input.id, ...input.permissionDelta.remove, input.id, audit.eventId],
      ));
    }
    if (input.permissionDelta.add.length > 0) {
      statements.push(run(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT ?, CAST(value AS TEXT) FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM roles WHERE id = ? AND revision_token = ?)`,
        [input.id, JSON.stringify(input.permissionDelta.add), input.id, audit.eventId],
      ));
    }
    try {
      const snapshotOffset = statements.length;
      statements.push(...roleSnapshotStatements(input.id, audit.eventId));
      const results = await this.executor.batch(statements);
      if (returnedRowCount(results[0]) !== 1) return { status: "conflict" } as const;
      const role = roleSnapshotFromResults(results.slice(snapshotOffset));
      if (!role) throw new Error("Updated role snapshot is missing");
      return { status: "updated", role } as const;
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return { status: "last_role_manager" } as const;
      throw error;
    }
  }

  async deleteRole(role: RoleRecord, audit: AuditEventWrite) {
    const references = await Promise.all([
      this.db.select({ value: count() }).from(users).where(eq(users.roleId, role.id)),
      this.db.select({ value: count() }).from(inviteLinks).where(eq(inviteLinks.roleId, role.id)),
    ]);
    if (references.some((rows) => Number(rows[0]?.value ?? 0) > 0)) return "referenced";
    try {
      const results = await this.executor.batch([
        returning(
          `DELETE FROM roles WHERE id = ? AND revision_token = ? AND COALESCE((
            SELECT group_concat(permission, ',') FROM (
              SELECT permission FROM role_permissions WHERE role_id = roles.id ORDER BY permission
            )
          ), '') = ?`,
          [role.id, role.revisionToken, permissionSnapshot(role.permissions)],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      return returnedRowCount(results[0]) === 1 ? "deleted" as const : "conflict" as const;
    } catch (error) {
      if (isForeignKeyViolation(error)) return "referenced";
      if (isLastRoleManagerViolation(error)) return "last_role_manager";
      throw error;
    }
  }

  async findInvite(id: string): Promise<InviteRecord | null> {
    const rows = await this.db.select({
      id: inviteLinks.id,
      code: inviteLinks.code,
      createdBy: inviteLinks.createdBy,
      roleId: inviteLinks.roleId,
      roleName: roles.name,
      roleColor: roles.color,
      roleLevel: roles.level,
      maxUses: inviteLinks.maxUses,
      usedCount: inviteLinks.usedCount,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
      revokedAt: inviteLinks.revokedAt,
    }).from(inviteLinks).innerJoin(roles, eq(inviteLinks.roleId, roles.id)).where(eq(inviteLinks.id, id)).limit(1);
    return rows[0] ?? null;
  }

  private async countRoleManagers(extra?: ReturnType<typeof eq> | ReturnType<typeof inArray>): Promise<number> {
    const conditions = [
      eq(users.isActive, true),
      isNull(users.deletedAt),
      eq(rolePermissions.permission, PERMISSION_ID.ADMIN_ROLES_MANAGE),
      ...(extra ? [extra] : []),
    ];
    const rows = await this.db.select({ value: count() }).from(users)
      .innerJoin(rolePermissions, eq(users.roleId, rolePermissions.roleId)).where(and(...conditions));
    return Number(rows[0]?.value ?? 0);
  }
}
