import { sql as drizzleSql } from "drizzle-orm";
import { availabilityToWindows } from "@guild/shared/schemas/user";
import type { SqlBatchStatement, SqlExecutor, SqlValue } from "@guild/kernel";
import type { AccountProvisioningStore } from "@guild/server/modules/auth";
import type { AppDatabase } from "../database.js";
import { users } from "../schema/auth.js";
import { auditInsertStatement } from "./audit-statement.js";
import {
  deleteSessionsAfterMutation,
  managedTargetSnapshot,
  permissionSnapshot,
  ROLE_SNAPSHOT_MATCH,
  TARGET_SNAPSHOT_MATCH,
  targetSnapshotCte,
} from "./managed-user-mutation.js";
import { returnedRowCount } from "./sql-result.js";

type ProvisioningSchema = { users: typeof users };

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
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

export class SqliteAccountProvisioningStore implements AccountProvisioningStore {
  constructor(
    private readonly db: AppDatabase<ProvisioningSchema>,
    private readonly executor: SqlExecutor,
  ) {}

  async redeemInviteAndCreateMember(
    input: Parameters<AccountProvisioningStore["redeemInviteAndCreateMember"]>[0],
    audit: Parameters<AccountProvisioningStore["redeemInviteAndCreateMember"]>[1],
  ): ReturnType<AccountProvisioningStore["redeemInviteAndCreateMember"]> {
    try {
      await this.executor.batch([
        run(
          `UPDATE invite_links SET used_count = used_count + 1
           WHERE id = ? AND code = ? AND revoked_at IS NULL AND used_count < max_uses
              AND (expires_at IS NULL OR expires_at > ?)`,
          [input.inviteId, input.inviteCode, input.now],
        ),
        run(
          `INSERT INTO users (id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at)
           SELECT ?, ?, role_id, 1, NULL, ?, ?, ? FROM invite_links
           WHERE id = ? AND changes() = 1`,
          [input.userId, input.displayName, audit.eventId, input.now, input.now, input.inviteId],
        ),
        run("INSERT INTO user_credentials (user_id, login_name, password_hash, updated_at) VALUES (?, ?, ?, ?)", [input.userId, input.loginName, input.passwordHash, input.now]),
        run("INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at) VALUES (?, 0, ?, ?, ?)", [input.userId, audit.eventId, input.now, input.now]),
        auditInsertStatement(audit),
      ]);
      return "created";
    } catch (error) {
      if (isUniqueViolation(error) && await this.displayNameExists(input.displayName.toLowerCase())) {
        return "display_name_taken";
      }
      if (isUniqueViolation(error) && await this.loginNameExists(input.loginName.toLowerCase())) {
        return "login_name_taken";
      }
      if (isForeignKeyViolation(error) || isUniqueViolation(error)) return "invite_unavailable";
      throw error;
    }
  }

  async createManagedUser(
    input: Parameters<AccountProvisioningStore["createManagedUser"]>[0],
    audit: Parameters<AccountProvisioningStore["createManagedUser"]>[1],
  ): ReturnType<AccountProvisioningStore["createManagedUser"]> {
    try {
      const results = await this.executor.batch([
        returning(
          `INSERT INTO users (id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at)
           SELECT ?, ?, destination.id, 1, NULL, ?, ?, ? FROM roles AS destination
           WHERE destination.id = ? AND destination.revision_token = ? AND destination.level = ?
             AND COALESCE((
               SELECT group_concat(permission, ',') FROM (
                 SELECT permission FROM role_permissions WHERE role_id = destination.id ORDER BY permission
               )
             ), '') = ?`,
          [
            input.id, input.displayName, audit.eventId, input.now, input.now,
            input.destinationRole.id, input.destinationRole.revisionToken, input.destinationRole.level,
            permissionSnapshot(input.destinationRole.permissions),
          ],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
        run(
          `INSERT INTO user_credentials
             (user_id, login_name, password_hash, temporary_password_expires_at, temporary_password_used_at, updated_at)
           SELECT ?, ?, ?, ?, NULL, ?
           WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision_token = ?)`,
          [
            input.id, input.loginName, input.passwordHash, input.temporaryPasswordExpiresAt, input.now,
            input.id, audit.eventId,
          ],
        ),
        run(
          "INSERT INTO member_profiles (user_id, power, notes, revision_token, created_at, updated_at) SELECT ?, 0, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision_token = ?)",
          [input.id, input.notes, audit.eventId, input.now, input.now, input.id, audit.eventId],
        ),
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" : "conflict";
    } catch (error) {
      if (isUniqueViolation(error) && await this.displayNameExists(input.displayName.toLowerCase())) return "display_name_taken";
      if (isUniqueViolation(error) && await this.loginNameExists(input.loginName.toLowerCase())) return "login_name_taken";
      throw error;
    }
  }

  async updateManagedMember(
    input: Parameters<AccountProvisioningStore["updateManagedMember"]>[0],
    audit: Parameters<AccountProvisioningStore["updateManagedMember"]>[1],
  ): ReturnType<AccountProvisioningStore["updateManagedMember"]> {
    const {
      target,
      expectedUserRevisionToken,
      expectedProfileRevisionToken,
      displayName,
      destinationRole,
      active,
      profile,
    } = input;
    const userMutation = displayName !== undefined || destinationRole !== undefined || active !== undefined;
    if (!userMutation && profile === undefined) throw new RangeError("Managed member update requires a change");
    const snapshot = targetSnapshotCte([target]);
    const finalRoleId = destinationRole?.id ?? target.roleId;
    const finalRoleRevisionToken = destinationRole?.revisionToken ?? target.roleRevisionToken;
    const finalRoleLevel = destinationRole?.level ?? target.roleLevel;
    const finalRolePermissions = destinationRole?.permissions ?? target.rolePermissions;
    const finalDisplayName = displayName ?? target.displayName;
    const finalActive = active ?? target.isActive;
    const finalDeletedAt = finalActive ? null : target.deletedAt;
    const statements: SqlBatchStatement[] = [];
    let primaryIndex: number | undefined;

    if (userMutation) {
      primaryIndex = statements.length;
      statements.push(returning(
        `${snapshot.sql}
         UPDATE users
         SET display_name = ?, role_id = ?, is_active = ?, deleted_at = CASE WHEN ? = 1 THEN NULL ELSE deleted_at END,
             revision_token = ?, updated_at = ?
         WHERE id IN (SELECT id FROM target_snapshot)
           AND ${TARGET_SNAPSHOT_MATCH}
           AND revision_token = ?
           AND EXISTS (
             SELECT 1 FROM member_profiles
             WHERE user_id = ? AND revision_token = ?
           )
           ${destinationRole === undefined ? "" : `AND ${ROLE_SNAPSHOT_MATCH}`}
           `,
        [
          ...snapshot.params,
          finalDisplayName,
          finalRoleId,
          finalActive ? 1 : 0,
          finalActive ? 1 : 0,
          audit.eventId,
          input.now,
          managedTargetSnapshot([target]),
          expectedUserRevisionToken,
          target.id,
          expectedProfileRevisionToken,
          ...(destinationRole === undefined ? [] : [
            destinationRole.id,
            destinationRole.revisionToken,
            destinationRole.level,
            permissionSnapshot(destinationRole.permissions),
          ]),
        ],
      ));
    }

    if (profile !== undefined) {
      primaryIndex ??= statements.length;
      statements.push(returning(
        `${userMutation ? "" : snapshot.sql}
         UPDATE member_profiles
         SET power = ?, title_html = ?, bio = ?, availability_timezone = ?, notes = ?, updated_at = ?, revision_token = ?
         WHERE user_id = ? AND revision_token = ?
           ${userMutation ? `AND EXISTS (
             SELECT 1 FROM users AS target
             JOIN roles AS target_role ON target_role.id = target.role_id
             WHERE target.id = ? AND target.role_id = ? AND target.revision_token = ?
               AND target_role.revision_token = ? AND target_role.level = ?
               AND target.is_active = ? AND target.deleted_at IS ?
               AND COALESCE((
                 SELECT group_concat(permission, ',') FROM (
                   SELECT permission FROM role_permissions WHERE role_id = target.role_id ORDER BY permission
                 )
               ), '') = ?
           )` : `AND ${TARGET_SNAPSHOT_MATCH}
             AND EXISTS (
               SELECT 1 FROM users
               WHERE id = ? AND revision_token = ?
             )`}`,
        [
          ...(userMutation ? [] : snapshot.params),
          profile.power,
          profile.titleHtml,
          profile.bio,
          profile.availability?.timezone ?? null,
          profile.notes,
          input.now,
          audit.eventId,
          target.id,
          expectedProfileRevisionToken,
          ...(userMutation ? [
            target.id,
            finalRoleId,
            audit.eventId,
            finalRoleRevisionToken,
            finalRoleLevel,
            finalActive ? 1 : 0,
            finalDeletedAt,
            permissionSnapshot(finalRolePermissions),
          ] : [managedTargetSnapshot([target]), target.id, expectedUserRevisionToken]),
        ],
      ));
    }

    const completionGuard = userMutation && profile !== undefined
      ? {
        sql: `SELECT 1 FROM users WHERE id = ? AND revision_token = ?
          AND EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        params: [target.id, audit.eventId, target.id, audit.eventId],
      }
      : userMutation
        ? { sql: "SELECT 1 FROM users WHERE id = ? AND revision_token = ?", params: [target.id, audit.eventId] }
        : { sql: "SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?", params: [target.id, audit.eventId] };
    statements.push(auditInsertStatement(audit, completionGuard));
    if (profile !== undefined) {
      statements.push(run(
        `DELETE FROM member_profile_classes
         WHERE user_id = ? AND EXISTS (
           SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?
         )`,
        [target.id, target.id, audit.eventId],
      ));
      statements.push(run(
        `INSERT INTO member_profile_classes (user_id, class_id, sort_order)
         SELECT ?, CAST(value AS TEXT), CAST(key AS INTEGER) FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [target.id, JSON.stringify(profile.classes), target.id, audit.eventId],
      ));
      const availabilityWindows = profile.availability === null ? [] : availabilityToWindows(profile.availability);
      statements.push(run(
        `DELETE FROM member_availability_windows
         WHERE user_id = ? AND EXISTS (
           SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?
         )`,
        [target.id, target.id, audit.eventId],
      ));
      statements.push(run(
        `INSERT INTO member_availability_windows (user_id, weekday, start_minute, end_minute)
         SELECT ?, CAST(json_extract(value, '$.weekday') AS INTEGER),
           CAST(json_extract(value, '$.startMinute') AS INTEGER), CAST(json_extract(value, '$.endMinute') AS INTEGER)
         FROM json_each(?)
         WHERE EXISTS (SELECT 1 FROM member_profiles WHERE user_id = ? AND revision_token = ?)`,
        [target.id, JSON.stringify(availabilityWindows), target.id, audit.eventId],
      ));
    }
    if (destinationRole !== undefined || active === false) statements.push(deleteSessionsAfterMutation([target], audit.eventId));
    if (primaryIndex === undefined) throw new Error("Managed member update has no primary write");

    try {
      const results = await this.executor.batch(statements);
      return returnedRowCount(results[primaryIndex]) === 1 ? "updated" : "conflict";
    } catch (error) {
      if (isLastRoleManagerViolation(error)) return "last_role_manager";
      if (isUniqueViolation(error) && displayName !== undefined && await this.displayNameExists(displayName.toLowerCase())) {
        return "display_name_taken";
      }
      throw error;
    }
  }

  private async displayNameExists(normalizedDisplayName: string): Promise<boolean> {
    const row = await this.db.select({ id: users.id }).from(users)
      .where(drizzleSql`${users.display_name} COLLATE NOCASE = ${normalizedDisplayName}`).limit(1);
    return row.length > 0;
  }

  private async loginNameExists(normalizedLoginName: string): Promise<boolean> {
    const row = await this.executor.execute({
      method: "get",
      sql: "SELECT 1 FROM user_credentials WHERE login_name COLLATE NOCASE = ? LIMIT 1",
      params: [normalizedLoginName],
    });
    return row.rows !== undefined;
  }
}
