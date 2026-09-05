import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type { OAuthChallenge, OAuthProvider, OAuthStore, ExternalIdentity } from "@guild/server/modules/auth";
import { auditInsertStatement } from "./audit-statement.js";

function run(sql: string, params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "run", sql, params };
}

function returning(sql: string, columns: readonly string[], params: readonly SqlValue[] = []): SqlBatchStatement {
  return { method: "all", columns: [...columns], sql, params };
}

function rows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined || !Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) return [];
  return result.rows as readonly (readonly SqlValue[])[];
}

function text(value: SqlValue, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid OAuth ${field}`);
  return value;
}

function nullableText(value: SqlValue, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function provider(value: SqlValue): OAuthProvider {
  const candidate = text(value, "provider");
  if (candidate !== "google" && candidate !== "discord" && candidate !== "kook" && candidate !== "wechat") {
    throw new Error("Invalid OAuth provider");
  }
  return candidate;
}

function challengeFromRow(row: readonly SqlValue[]): OAuthChallenge {
  if (row.length !== 10) throw new Error("Invalid OAuth challenge row");
  const purpose = text(row[3]!, "purpose");
  if (purpose !== "login" && purpose !== "link") throw new Error("Invalid OAuth purpose");
  return {
    stateDigest: text(row[0]!, "state digest"),
    browserBindingDigest: text(row[1]!, "browser binding digest"),
    provider: provider(row[2]!),
    purpose,
    userId: nullableText(row[4]!, "user id"),
    nonce: nullableText(row[5]!, "nonce"),
    pkceVerifier: nullableText(row[6]!, "PKCE verifier"),
    authRevision: row[7] === null ? null : number(row[7]!, "auth revision"),
    expiresAt: text(row[8]!, "expiry"),
  };
}

function number(value: SqlValue, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid OAuth ${field}`);
  }
  return value;
}

function identityFromRow(row: readonly SqlValue[]): ExternalIdentity {
  if (row.length !== 6) throw new Error("Invalid external identity row");
  return {
    id: text(row[0]!, "identity id"),
    userId: text(row[1]!, "user id"),
    provider: provider(row[2]!),
    providerSubject: text(row[3]!, "subject"),
    createdAt: text(row[4]!, "created at"),
    lastUsedAt: text(row[5]!, "last used at"),
  };
}

export class SqliteOAuthStore implements OAuthStore {
  constructor(private readonly sql: SqlExecutor) {}

  async createChallenge(challenge: OAuthChallenge & Readonly<{ createdAt: string }>): Promise<void> {
    await this.sql.batch([
      run(
        `DELETE FROM oauth_challenges WHERE state_digest IN (
           SELECT state_digest FROM oauth_challenges
           WHERE consumed_at IS NOT NULL OR expires_at <= ?
           ORDER BY expires_at LIMIT 100
         )`,
        [challenge.createdAt],
      ),
      run(
        `INSERT INTO oauth_challenges
          (state_digest, browser_binding_digest, provider, purpose, user_id, nonce, pkce_verifier, auth_revision, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          challenge.stateDigest, challenge.browserBindingDigest, challenge.provider, challenge.purpose, challenge.userId,
          challenge.nonce, challenge.pkceVerifier, challenge.authRevision, challenge.expiresAt, challenge.createdAt,
        ],
      ),
    ]);
  }

  async consumeChallenge(
    stateDigest: string,
    browserBindingDigest: string,
    requestedProvider: OAuthProvider,
    now: string,
  ): Promise<OAuthChallenge | null> {
    const result = await this.sql.execute(returning(
      `UPDATE oauth_challenges SET consumed_at = ?
       WHERE state_digest = ? AND browser_binding_digest = ? AND provider = ?
         AND consumed_at IS NULL AND expires_at > ?
       RETURNING state_digest, browser_binding_digest, provider, purpose, user_id, nonce, pkce_verifier, auth_revision, expires_at, created_at`,
      ["state_digest", "browser_binding_digest", "provider", "purpose", "user_id", "nonce", "pkce_verifier", "auth_revision", "expires_at", "created_at"],
      [now, stateDigest, browserBindingDigest, requestedProvider, now],
    ));
    const row = rows(result)[0];
    return row ? challengeFromRow(row) : null;
  }

  async findIdentity(providerValue: OAuthProvider, providerSubject: string): Promise<ExternalIdentity | null> {
    const result = await this.sql.read({
      method: "get",
      columns: ["id", "user_id", "provider", "provider_subject", "created_at", "last_used_at"],
      sql: `SELECT id, user_id, provider, provider_subject, created_at, last_used_at
        FROM external_identities WHERE provider = ? AND provider_subject = ? LIMIT 1`,
      params: [providerValue, providerSubject],
    });
    const row = result.rows;
    return row === undefined || Array.isArray(row[0]) ? null : identityFromRow(row as readonly SqlValue[]);
  }

  async touchIdentity(providerValue: OAuthProvider, providerSubject: string, now: string): Promise<void> {
    await this.sql.execute(run(
      "UPDATE external_identities SET last_used_at = ? WHERE provider = ? AND provider_subject = ?",
      [now, providerValue, providerSubject],
    ));
  }

  async listIdentities(userId: string): Promise<readonly ExternalIdentity[]> {
    const result = await this.sql.read({
      method: "all",
      columns: ["id", "user_id", "provider", "provider_subject", "created_at", "last_used_at"],
      sql: `SELECT id, user_id, provider, provider_subject, created_at, last_used_at
        FROM external_identities WHERE user_id = ? ORDER BY provider`,
      params: [userId],
    });
    return rows(result).map(identityFromRow);
  }

  async linkIdentity(input: Parameters<OAuthStore["linkIdentity"]>[0]): Promise<"linked" | "already_linked" | "linked_elsewhere" | "invalid"> {
    const existing = await this.findIdentity(input.provider, input.providerSubject);
    if (existing) return existing.userId === input.userId ? "already_linked" : "linked_elsewhere";
    try {
      const results = await this.sql.batch([
        returning(
          `INSERT INTO external_identities (id, user_id, provider, provider_subject, created_at, last_used_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM user_credentials WHERE user_id = ? AND auth_revision = ?
           )
           RETURNING 1 AS affected`,
          ["affected"],
          [
            input.id,
            input.userId,
            input.provider,
            input.providerSubject,
            input.now,
            input.now,
            input.userId,
            input.expectedAuthRevision,
          ],
        ),
        auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      ]);
      if (rows(results[0] ?? { rows: [] }).length === 1) return "linked";
      return "invalid";
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
      const raced = await this.findIdentity(input.provider, input.providerSubject);
      return raced?.userId === input.userId ? "already_linked" : "linked_elsewhere";
    }
  }

  async unlinkIdentity(input: Parameters<OAuthStore["unlinkIdentity"]>[0]): Promise<boolean> {
    const completedAudit = {
      sql: "SELECT 1 FROM audit_log WHERE id = ?",
      params: [input.audit.eventId] as const,
    };
    const result = await this.sql.batch([
      returning(
        `UPDATE user_credentials SET auth_revision = auth_revision + 1
         WHERE user_id = ? AND auth_revision = ?
           AND EXISTS (SELECT 1 FROM external_identities WHERE user_id = ? AND provider = ?)
         RETURNING 1 AS affected`,
        ["affected"],
        [input.userId, input.expectedAuthRevision, input.userId, input.provider],
      ),
      run("DELETE FROM external_identities WHERE user_id = ? AND provider = ? AND changes() = 1", [
        input.userId,
        input.provider,
      ]),
      auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }),
      run(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (${completedAudit.sql})`, [
        input.userId,
        ...completedAudit.params,
      ]),
    ]);
    return rows(result[0] ?? { rows: [] }).length === 1;
  }
}
