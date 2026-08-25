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
  LoginFailureRecord,
  ManagedUserTarget,
  RoleRecord,
  SessionAuthorizationRecord,
} from "@guild/server/modules/auth";
import type { AuditEventWrite } from "@guild/server/modules/audit";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlValue } from "@guild/kernel";
import { inviteLinks, loginFailures, rolePermissions, roles, sessions, userCredentials, users } from "../schema/auth.js";
import { auditInsertSelectStatement, auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";

type AuthSchema = {
  roles: typeof roles;
  rolePermissions: typeof rolePermissions;
  users: typeof users;
  userCredentials: typeof userCredentials;
  inviteLinks: typeof inviteLinks;
  loginFailures: typeof loginFailures;
  sessions: typeof sessions;
};

const permissionIds = new Set<string>(PERMISSIONS);

function toPermissionSet(rows: readonly Readonly<{ permission: string | null }>[]): ReadonlySet<Permission> {
  return new Set(rows
    .map((row) => row.permission)
    .filter((permission): permission is Permission => permission !== null && permissionIds.has(permission)));
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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}

function isLastRoleManagerViolation(error: unknown): boolean {
  return error instanceof Error && /last role manager required/i.test(error.message);
}

const MAX_MANAGED_USER_BATCH = 50;

function permissionSnapshot(permissions: ReadonlySet<Permission> | readonly Permission[]): string {
  return [...permissions].sort().join(",");
}

function managedTargetSnapshot(targets: readonly ManagedUserTarget[]): string {
  return [...targets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((target) => [
      target.id,
      target.roleId,
      target.revisionToken,
      target.roleRevisionToken,
      target.roleLevel,
      target.isActive ? 1 : 0,
      target.deletedAt ?? "",
      permissionSnapshot(target.rolePermissions),
    ].join("\u001f"))
    .join("\u001e");
}

function assertManagedBatch(targets: readonly ManagedUserTarget[]): void {
  if (targets.length < 1 || targets.length > MAX_MANAGED_USER_BATCH || new Set(targets.map(({ id }) => id)).size !== targets.length) {
    throw new RangeError(`Managed user batches must contain 1 to ${MAX_MANAGED_USER_BATCH} unique users`);
  }
}

function targetSnapshotCte(targets: readonly ManagedUserTarget[]): Readonly<{ sql: string; params: readonly SqlValue[] }> {
  assertManagedBatch(targets);
  return {
    sql: `WITH target_snapshot AS (
      SELECT u.id, u.role_id, u.revision_token, role.revision_token AS role_revision_token,
        role.level AS role_level, u.is_active, u.deleted_at,
        COALESCE((
          SELECT group_concat(permission, ',') FROM (
            SELECT permission FROM role_permissions WHERE role_id = u.role_id ORDER BY permission
          )
        ), '') AS permission_snapshot
      FROM users AS u
      JOIN roles AS role ON role.id = u.role_id
      WHERE u.id IN (${placeholders(targets)})
    )`,
    params: targets.map(({ id }) => id),
  };
}

function deleteSessionsAfterMutation(targets: readonly ManagedUserTarget[], revisionToken: string): SqlBatchStatement {
  return run(
    `WITH intended(id) AS (VALUES ${targets.map(() => "(?)").join(", ")})
     DELETE FROM sessions
     WHERE user_id IN (SELECT id FROM intended)
       AND (SELECT count(*) FROM users JOIN intended ON intended.id = users.id WHERE users.revision_token = ?) = ?`,
    [...targets.map(({ id }) => id), revisionToken, targets.length],
  );
}

const TARGET_SNAPSHOT_MATCH = `COALESCE((
  SELECT group_concat(snapshot, char(30)) FROM (
    SELECT id || char(31) || role_id || char(31) || revision_token || char(31)
      || role_revision_token || char(31) || role_level || char(31) || is_active || char(31)
      || COALESCE(deleted_at, '') || char(31) || permission_snapshot AS snapshot
    FROM target_snapshot ORDER BY id
  )
), '') = ?`;

function loginLockResetAuditStatement(
  audit: AuditEventWrite,
  target: ManagedUserTarget,
  snapshot: Readonly<{ sql: string; params: readonly SqlValue[] }>,
): SqlBatchStatement {
  return auditInsertSelectStatement(
    `${snapshot.sql}, failure_snapshot AS (
       SELECT fail_count, locked_until FROM login_failures WHERE login_name = ?
     )
     SELECT ?, ?, ?, ?,
       CASE WHEN ? = 'user' THEN (SELECT display_name FROM users WHERE id = ?) ELSE ? END,
       ?, ?, ?, ?,
       json_object(
         'schema_version', 2,
         'changes', json('[]'),
         'context', json_array(
           json_object(
              'field', 'failed_attempts',
             'value', json_object(
               'type', 'number',
               'value', COALESCE((SELECT fail_count FROM failure_snapshot), 0)
             )
           ),
           json_object(
              'field', 'locked_until',
             'value', json_object(
               'type', CASE WHEN (SELECT locked_until FROM failure_snapshot) IS NULL THEN 'null' ELSE 'datetime' END,
               'value', (SELECT locked_until FROM failure_snapshot)
             )
           )
         )
       ), ?
     WHERE ${TARGET_SNAPSHOT_MATCH}`,
    [
      ...snapshot.params,
      target.loginName.toLowerCase(),
      audit.eventId,
      audit.requestId,
      audit.actorKind,
      audit.actorId,
      audit.actorKind,
      audit.actorId,
      audit.actorLabel,
      audit.subjectType,
      audit.subjectId,
      audit.subjectLabel,
      audit.action,
      audit.occurredAt,
      managedTargetSnapshot([target]),
    ],
  );
}

const ROLE_SNAPSHOT_MATCH = `EXISTS (
  SELECT 1 FROM roles AS destination
  WHERE destination.id = ? AND destination.revision_token = ? AND destination.level = ?
    AND COALESCE((
      SELECT group_concat(permission, ',') FROM (
        SELECT permission FROM role_permissions WHERE role_id = destination.id ORDER BY permission
      )
    ), '') = ?
)`;

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

  async readLoginFailure(normalizedLoginName: string): Promise<LoginFailureRecord | null> {
    const rows = await this.db.select({ failCount: loginFailures.failCount, lockedUntil: loginFailures.lockedUntil })
      .from(loginFailures).where(eq(loginFailures.loginName, normalizedLoginName)).limit(1);
    return rows[0] ?? null;
  }

  async recordLoginFailure(input: Readonly<{
    normalizedLoginName: string;
    now: string;
    freeAttempts: number;
    lockSeconds: readonly number[];
  }>): Promise<LoginFailureRecord> {
    const deadlines = input.lockSeconds.map((seconds) => new Date(Date.parse(input.now) + seconds * 1_000).toISOString());
    const nextCount = drizzleSql<number>`${loginFailures.failCount} + 1`;
    const cases = input.lockSeconds.map((_, index) => drizzleSql`WHEN ${nextCount} = ${input.freeAttempts + index + 1} THEN ${deadlines[index]}`);
    const candidate = drizzleSql<string | null>`CASE
      WHEN ${nextCount} <= ${input.freeAttempts} THEN NULL
      ${drizzleSql.join(cases, drizzleSql.raw(" "))}
      ELSE ${deadlines.at(-1) ?? input.now}
    END`;
    const rows = await this.db.insert(loginFailures)
      .values({ loginName: input.normalizedLoginName, failCount: 1, lockedUntil: null, lastFailedAt: input.now })
      .onConflictDoUpdate({
        target: loginFailures.loginName,
        set: {
          failCount: nextCount,
          lockedUntil: drizzleSql`CASE
            WHEN ${nextCount} <= ${input.freeAttempts} THEN ${loginFailures.lockedUntil}
            WHEN ${loginFailures.lockedUntil} IS NULL OR ${loginFailures.lockedUntil} < ${candidate} THEN ${candidate}
            ELSE ${loginFailures.lockedUntil}
          END`,
          lastFailedAt: input.now,
        },
      })
      .returning({ failCount: loginFailures.failCount, lockedUntil: loginFailures.lockedUntil });
    return rows[0] ?? { failCount: 1, lockedUntil: null };
  }

  async clearLoginFailures(normalizedLoginName: string): Promise<void> {
    await this.db.delete(loginFailures).where(eq(loginFailures.loginName, normalizedLoginName));
  }

  async pruneLoginFailures(before: string, now: string, limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("Login-failure prune limit must be between 1 and 1000");
    await this.executor.execute(run(
      `DELETE FROM login_failures WHERE login_name IN (
        SELECT login_name FROM login_failures
        WHERE last_failed_at < ? AND (locked_until IS NULL OR locked_until < ?)
        ORDER BY last_failed_at, login_name LIMIT ?
      )`,
      [before, now, limit],
    ));
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

  async findActiveInvite(tokenDigest: string, now: string): Promise<InviteRecord | null> {
    const rows = await this.db.select({
      id: inviteLinks.id,
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
      eq(inviteLinks.tokenDigest, tokenDigest),
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
        run(`DELETE FROM login_failures WHERE login_name IN (lower(?), lower(?))
          AND EXISTS (${completedAudit.sql})`, [
          input.previousLoginName,
          input.loginName,
          ...completedAudit.params,
        ]),
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
        run(
          `DELETE FROM login_failures WHERE login_name IN (lower(?), lower(?))
           AND EXISTS (${completedAudit.sql})`,
          [input.target.loginName, input.temporaryLoginName, ...completedAudit.params],
        ),
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
        run(
          `DELETE FROM login_failures WHERE login_name IN (lower(?), lower(?))
           AND EXISTS (${openedSession.sql})`,
          [input.previousLoginName, input.loginName, ...openedSession.params],
        ),
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
    if (input.exactTokenDigest) {
      filters.push(eq(inviteLinks.tokenDigest, input.exactTokenDigest));
    } else if (input.search) {
      const escaped = input.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const pattern = `%${escaped}%`;
      filters.push(or(
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
        `INSERT INTO invite_links (id, token_digest, created_by, role_id, max_uses, used_count, expires_at, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
        [input.id, input.tokenDigest, input.createdBy, input.roleId, input.maxUses, input.expiresAt, input.now],
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

  async resetUserLoginLock(target: ManagedUserTarget, audit: AuditEventWrite) {
    const snapshot = targetSnapshotCte([target]);
    const results = await this.executor.batch([
      {
        method: "get",
        columns: ["fail_count", "locked_until"],
        sql: `${snapshot.sql}
          SELECT failure.fail_count, failure.locked_until
          FROM target_snapshot AS target
          LEFT JOIN login_failures AS failure ON failure.login_name = ?
          WHERE ${TARGET_SNAPSHOT_MATCH}
          LIMIT 1`,
        params: [...snapshot.params, target.loginName.toLowerCase(), managedTargetSnapshot([target])],
      },
      loginLockResetAuditStatement(audit, target, snapshot),
      run(
        `${snapshot.sql}
         DELETE FROM login_failures WHERE login_name = ? AND ${TARGET_SNAPSHOT_MATCH}`,
        [...snapshot.params, target.loginName.toLowerCase(), managedTargetSnapshot([target])],
      ),
    ]);
    if (results[0]?.rows === undefined) return { outcome: "conflict" as const };
    const row = results[0].rows;
    if (!Array.isArray(row) || row.some(Array.isArray) || row.length !== 2) throw new Error("Invalid login-lock reset row");
    const [failCount, lockedUntil] = row;
    if (failCount === null) return { outcome: "updated" as const, previous: null };
    if (typeof failCount !== "number" || !Number.isSafeInteger(failCount) || failCount < 0
      || (lockedUntil !== null && typeof lockedUntil !== "string")) {
      throw new Error("Invalid login-lock reset values");
    }
    return { outcome: "updated" as const, previous: { failCount, lockedUntil } };
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
    const role = (await this.db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
    if (!role) return null;
    const [permissionRows, assignedRows] = await Promise.all([
      this.db.select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId)),
      this.db.select({ value: count() })
        .from(users)
        .where(and(eq(users.roleId, roleId), isNull(users.deletedAt))),
    ]);
    return {
      id: role.id,
      name: role.name,
      level: role.level,
      color: role.color,
      permissions: toPermissionSet(permissionRows),
      assignedUserCount: Number(assignedRows[0]?.value ?? 0),
      revisionToken: role.revisionToken,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  async createRole(input: Parameters<AuthStore["createRole"]>[0], audit: AuditEventWrite): Promise<"created" | "conflict"> {
    try {
      const results = await this.executor.batch([
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
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" : "conflict";
    } catch (error) {
      if (isUniqueViolation(error)) return "conflict";
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
      const results = await this.executor.batch(statements);
      return returnedRowCount(results[0]) === 1 ? "updated" as const : "conflict" as const;
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return "last_role_manager" as const;
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
