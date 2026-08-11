import { sql as drizzleSql } from "drizzle-orm";
import type { SqlBatchStatement, SqlExecutor, SqlValue } from "@guild/kernel";
import type { AccountProvisioningStore } from "@guild/server/modules/auth";
import type { AppDatabase } from "../database.js";
import { users } from "../schema/auth.js";
import { auditInsertStatement } from "./audit-statement.js";
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

function permissionSnapshot(permissions: ReadonlySet<string>): string {
  return [...permissions].sort().join(",");
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
           WHERE id = ? AND token_digest = ? AND revoked_at IS NULL AND used_count < max_uses
             AND (expires_at IS NULL OR expires_at > ?)`,
          [input.inviteId, input.tokenDigest, input.now],
        ),
        run(
          `INSERT INTO users (id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at)
           SELECT ?, ?, role_id, 1, NULL, ?, ?, ? FROM invite_links
           WHERE id = ? AND changes() = 1`,
          [input.userId, input.username, audit.id, input.now, input.now, input.inviteId],
        ),
        run("INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)", [input.userId, input.passwordHash, input.now]),
        run("INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at) VALUES (?, 0, ?, ?, ?)", [input.userId, audit.id, input.now, input.now]),
        auditInsertStatement(audit),
      ]);
      return "created";
    } catch (error) {
      if (isUniqueViolation(error) && await this.usernameExists(input.username.toLowerCase())) {
        return "username_taken";
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
          `INSERT INTO users (id, username, role_id, is_active, deleted_at, revision_token, created_at, updated_at)
           SELECT ?, ?, destination.id, 1, NULL, ?, ?, ? FROM roles AS destination
           WHERE destination.id = ? AND destination.revision_token = ? AND destination.level = ?
             AND COALESCE((
               SELECT group_concat(permission, ',') FROM (
                 SELECT permission FROM role_permissions WHERE role_id = destination.id ORDER BY permission
               )
             ), '') = ?`,
          [
            input.id, input.username, audit.id, input.now, input.now,
            input.destinationRole.id, input.destinationRole.revisionToken, input.destinationRole.level,
            permissionSnapshot(input.destinationRole.permissions),
          ],
        ),
        auditInsertStatement(audit, { sql: "SELECT 1 WHERE changes() = 1" }),
        run(
          "INSERT INTO user_credentials (user_id, password_hash, updated_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision_token = ?)",
          [input.id, input.passwordHash, input.now, input.id, audit.id],
        ),
        run(
          "INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at) SELECT ?, 0, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND revision_token = ?)",
          [input.id, audit.id, input.now, input.now, input.id, audit.id],
        ),
      ]);
      return returnedRowCount(results[0]) === 1 ? "created" : "conflict";
    } catch (error) {
      if (isUniqueViolation(error)) return "username_taken";
      throw error;
    }
  }

  private async usernameExists(normalizedUsername: string): Promise<boolean> {
    const row = await this.db.select({ id: users.id }).from(users)
      .where(drizzleSql`${users.username} COLLATE NOCASE = ${normalizedUsername}`).limit(1);
    return row.length > 0;
  }
}
