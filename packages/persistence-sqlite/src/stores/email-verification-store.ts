import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type { EmailVerificationStore, PendingEmailVerification } from "@guild/server/modules/auth";
import { auditInsertStatement } from "./audit-statement.js";

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
}

function all(sql: string, columns: readonly string[], params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "all", columns, sql, params };
}

function rows(result: SqlResult): readonly (readonly SqlValue[])[] {
  return result.rows !== undefined && Array.isArray(result.rows) && result.rows.every(Array.isArray)
    ? result.rows as readonly (readonly SqlValue[])[]
    : [];
}

function rowText(value: SqlValue, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid email verification ${field}`);
  return value;
}

function pendingFromRow(row: readonly SqlValue[]): PendingEmailVerification {
  if (row.length !== 6 || typeof row[4] !== "number") throw new Error("Invalid email verification challenge row");
  return {
    tokenDigest: rowText(row[0]!, "token digest"),
    userId: rowText(row[1]!, "user id"),
    pendingEmail: rowText(row[2]!, "email"),
    expiresAt: rowText(row[3]!, "expiry"),
    sentCount: row[4]!,
    lastSentAt: rowText(row[5]!, "sent time"),
  };
}

export class SqliteEmailVerificationStore implements EmailVerificationStore {
  constructor(private readonly sql: SqlExecutor) {}

  async getVerifiedEmail(userId: string): Promise<string | null> {
    const result = await this.sql.read({
      method: "get",
      columns: ["normalized_email"],
      sql: "SELECT normalized_email FROM user_emails WHERE user_id = ? LIMIT 1",
      params: [userId],
    });
    if (result.rows === undefined || Array.isArray(result.rows[0])) return null;
    return rowText((result.rows as readonly SqlValue[])[0]!, "verified email");
  }

  async createChallenge(input: Parameters<EmailVerificationStore["createChallenge"]>[0]): Promise<boolean> {
    const credentialRevision = {
      sql: "SELECT 1 FROM user_credentials WHERE user_id = ? AND auth_revision = ?",
      params: [input.userId, input.expectedAuthRevision] as const,
    };
    const results = await this.sql.batch([
      run(
        `UPDATE email_verification_challenges SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL
           AND COALESCE((
             SELECT SUM(sent_count) FROM email_verification_challenges
             WHERE user_id = ? AND datetime(last_sent_at) > datetime(?, '-' || ? || ' seconds')
            ), 0) < ? AND EXISTS (${credentialRevision.sql})`,
        [
          input.now,
          input.userId,
          input.userId,
          input.now,
          input.sendWindowSeconds,
          input.maximumSendsInWindow,
          ...credentialRevision.params,
        ],
      ),
      all(
        `INSERT INTO email_verification_challenges
          (token_digest, user_id, pending_email, expires_at, consumed_at, sent_count, last_sent_at, created_at)
         SELECT ?, ?, ?, ?, NULL, 1, ?, ?
         WHERE COALESCE((
           SELECT SUM(sent_count) FROM email_verification_challenges
           WHERE user_id = ? AND datetime(last_sent_at) > datetime(?, '-' || ? || ' seconds')
          ), 0) < ? AND EXISTS (${credentialRevision.sql})
         RETURNING token_digest`,
        ["token_digest"],
        [
          input.tokenDigest,
          input.userId,
          input.pendingEmail,
          input.expiresAt,
          input.now,
          input.now,
          input.userId,
          input.now,
          input.sendWindowSeconds,
          input.maximumSendsInWindow,
          ...credentialRevision.params,
        ],
      ),
    ]);
    return rows(results[1] ?? { rows: [] }).length === 1;
  }

  async findActiveChallenge(userId: string, now: string): Promise<PendingEmailVerification | null> {
    const result = await this.sql.read({
      method: "get",
      columns: ["token_digest", "user_id", "pending_email", "expires_at", "sent_count", "last_sent_at"],
      sql: `SELECT token_digest, user_id, pending_email, expires_at, sent_count, last_sent_at
        FROM email_verification_challenges
        WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
      params: [userId, now],
    });
    if (result.rows === undefined || Array.isArray(result.rows[0])) return null;
    return pendingFromRow(result.rows as readonly SqlValue[]);
  }

  async reserveResend(input: Parameters<EmailVerificationStore["reserveResend"]>[0]): Promise<PendingEmailVerification | null> {
    const credentialRevision = {
      sql: "SELECT 1 FROM user_credentials WHERE user_id = ? AND auth_revision = ?",
      params: [input.userId, input.expectedAuthRevision] as const,
    };
    const result = await this.sql.execute(all(
      `UPDATE email_verification_challenges
       SET token_digest = ?, sent_count = sent_count + 1, last_sent_at = ?
       WHERE token_digest = (
         SELECT token_digest FROM email_verification_challenges
         WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?
           AND sent_count < ? AND datetime(last_sent_at, '+' || ? || ' seconds') <= datetime(?)
           AND COALESCE((
             SELECT SUM(sent_count) FROM email_verification_challenges
             WHERE user_id = ? AND datetime(last_sent_at) > datetime(?, '-' || ? || ' seconds')
           ), 0) < ?
         ORDER BY created_at DESC LIMIT 1
        ) AND EXISTS (${credentialRevision.sql})
       RETURNING token_digest, user_id, pending_email, expires_at, sent_count, last_sent_at`,
      ["token_digest", "user_id", "pending_email", "expires_at", "sent_count", "last_sent_at"],
      [
        input.nextTokenDigest,
        input.now,
        input.userId,
        input.now,
        input.maximumSends,
        input.minimumIntervalSeconds,
        input.now,
        input.userId,
        input.now,
        input.sendWindowSeconds,
        input.maximumSendsInWindow,
        ...credentialRevision.params,
      ],
    ));
    const row = rows(result)[0];
    return row ? pendingFromRow(row) : null;
  }

  async invalidateChallenge(tokenDigest: string, now: string): Promise<void> {
    await this.sql.execute(run(
      "UPDATE email_verification_challenges SET consumed_at = ? WHERE token_digest = ? AND consumed_at IS NULL",
      [now, tokenDigest],
    ));
  }

  async verify(input: Parameters<EmailVerificationStore["verify"]>[0]): Promise<"verified" | "invalid" | "email_taken"> {
    try {
      const results = await this.sql.batch([
        all(
          `UPDATE email_verification_challenges SET consumed_at = ?
           WHERE token_digest = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
           RETURNING token_digest`,
          ["token_digest"],
          [input.now, input.tokenDigest, input.userId, input.now],
        ),
        run(
          `INSERT INTO user_emails (user_id, normalized_email, verified_at, created_at, updated_at)
           SELECT user_id, pending_email, ?, ?, ? FROM email_verification_challenges
           WHERE token_digest = ? AND user_id = ? AND consumed_at = ? AND expires_at > ?
             AND changes() = 1
           ON CONFLICT(user_id) DO UPDATE SET
             normalized_email = excluded.normalized_email,
             verified_at = excluded.verified_at,
             updated_at = excluded.updated_at`,
          [
            input.now,
            input.now,
            input.now,
            input.tokenDigest,
            input.userId,
            input.now,
            input.now,
          ],
        ),
        auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      return rows(results[0] ?? { rows: [] }).length === 1 ? "verified" : "invalid";
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return "email_taken";
      throw error;
    }
  }

  async removeVerifiedEmail(input: Parameters<EmailVerificationStore["removeVerifiedEmail"]>[0]): Promise<boolean> {
    const credentialRevision = {
      sql: "SELECT 1 FROM user_credentials WHERE user_id = ? AND auth_revision = ?",
      params: [input.userId, input.expectedAuthRevision] as const,
    };
    const completedAudit = {
      sql: "SELECT 1 FROM audit_log WHERE id = ?",
      params: [input.audit.eventId] as const,
    };
    const results = await this.sql.batch([
      all(
        `DELETE FROM user_emails WHERE user_id = ? AND EXISTS (${credentialRevision.sql})
         RETURNING user_id`,
        ["user_id"],
        [input.userId, ...credentialRevision.params],
      ),
      auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      run(
        `DELETE FROM email_verification_challenges
          WHERE user_id = ? AND consumed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?)
            AND EXISTS (${completedAudit.sql})`,
        [input.userId, input.userId, ...completedAudit.params],
      ),
    ]);
    return rows(results[0] ?? { rows: [] }).length === 1;
  }
}
