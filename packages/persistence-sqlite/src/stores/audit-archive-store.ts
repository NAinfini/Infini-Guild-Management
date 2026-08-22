import { AppError } from "@guild/kernel";
import type {
  AuditArchiveClaim,
  AuditArchiveManifest,
  AuditArchiveStore,
} from "@guild/server/modules/audit";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { mapAuditSqlRow } from "./audit-store.js";
import {
  observedBacklog,
  SCHEDULED_BACKLOG_READ_LIMIT,
} from "./scheduled-backlog.js";
import { returnedRowCount } from "./sql-result.js";

const MAX_ARCHIVE_MONTHS = 240;
const MAX_ARCHIVE_FILES_PER_MONTH = 500;

export class SqliteAuditArchiveStore implements AuditArchiveStore {
  constructor(private readonly sql: SqlExecutor) {}

  async claim(input: Parameters<AuditArchiveStore["claim"]>[0]): Promise<AuditArchiveClaim | null> {
    const resumed = oneRow(await this.sql.execute({
      method: "get",
      sql: `UPDATE audit_archives
        SET lease_token = ?, lease_expires_at = ?
        WHERE id = (
          SELECT id FROM audit_archives
          WHERE status = 'pending' AND lease_expires_at <= ?
          ORDER BY created_at, id LIMIT 1
        )
          AND status = 'pending' AND lease_expires_at <= ?
        RETURNING id, month, object_key`,
      params: [input.leaseToken, input.leaseExpiresAt, input.now, input.now],
    }));
    if (resumed) {
      const [id, month, objectKey] = resumed;
      if (typeof id !== "string" || typeof month !== "string" || typeof objectKey !== "string") {
        throw corrupt("Invalid resumed audit archive claim");
      }
      return this.loadClaim(id, input.leaseToken, month, objectKey);
    }

    const results = await this.sql.batch([
      {
        method: "run",
        sql: `INSERT OR IGNORE INTO audit_archives (
          id, month, status, object_key, row_count, lease_token, lease_expires_at, created_at
        ) VALUES (?, ?, 'pending', ?, 0, ?, ?, ?)`,
        params: [input.id, input.month, input.objectKey, input.leaseToken, input.leaseExpiresAt, input.now],
      },
      {
        method: "run",
        sql: `INSERT INTO audit_archive_items (archive_id, audit_id, position)
          SELECT ?, candidates.audit_id, candidates.position
          FROM (
            SELECT logs.id AS audit_id,
              row_number() OVER (ORDER BY logs.occurred_at, logs.id) - 1 AS position
            FROM audit_log AS logs
            WHERE logs.occurred_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM audit_archive_items AS claimed WHERE claimed.audit_id = logs.id
              )
            ORDER BY logs.occurred_at, logs.id
            LIMIT ?
          ) AS candidates
          WHERE EXISTS (
            SELECT 1 FROM audit_archives
            WHERE id = ? AND status = 'pending' AND lease_token = ?
          )`,
        params: [input.id, input.before, input.limit, input.id, input.leaseToken],
      },
      {
        method: "run",
        sql: `UPDATE audit_archives
          SET row_count = (SELECT COUNT(*) FROM audit_archive_items WHERE archive_id = ?),
              starts_at = (
                SELECT logs.occurred_at
                FROM audit_archive_items AS items
                JOIN audit_log AS logs ON logs.id = items.audit_id
                WHERE items.archive_id = ?
                ORDER BY items.position LIMIT 1
              ),
              ends_at = (
                SELECT logs.occurred_at
                FROM audit_archive_items AS items
                JOIN audit_log AS logs ON logs.id = items.audit_id
                WHERE items.archive_id = ?
                ORDER BY items.position DESC LIMIT 1
              ),
              month = COALESCE((
                SELECT substr(logs.occurred_at, 1, 7)
                FROM audit_archive_items AS items
                JOIN audit_log AS logs ON logs.id = items.audit_id
                WHERE items.archive_id = ?
                ORDER BY items.position LIMIT 1
              ), month),
              object_key = COALESCE((
                SELECT 'audit/' || substr(logs.occurred_at, 1, 4) || '/'
                  || substr(logs.occurred_at, 6, 2) || '/' || audit_archives.id || '.ndjson'
                FROM audit_archive_items AS items
                JOIN audit_log AS logs ON logs.id = items.audit_id
                WHERE items.archive_id = ?
                ORDER BY items.position LIMIT 1
              ), object_key)
          WHERE id = ? AND status = 'pending' AND lease_token = ?`,
        params: [input.id, input.id, input.id, input.id, input.id, input.id, input.leaseToken],
      },
      {
        method: "get",
        columns: ["id", "month", "object_key"],
        sql: `SELECT id, month, object_key FROM audit_archives
          WHERE id = ? AND status = 'pending' AND lease_token = ? AND row_count > 0`,
        params: [input.id, input.leaseToken],
      },
      {
        method: "run",
        sql: `DELETE FROM audit_archives
          WHERE id = ? AND status = 'pending' AND lease_token = ? AND row_count = 0`,
        params: [input.id, input.leaseToken],
      },
    ]);
    const created = oneRow(results[3]);
    if (!created) return null;
    const [id, month, objectKey] = created;
    if (typeof id !== "string" || typeof month !== "string" || typeof objectKey !== "string") {
      throw corrupt("Invalid created audit archive claim");
    }
    return this.loadClaim(id, input.leaseToken, month, objectKey);
  }

  async finalize(input: Parameters<AuditArchiveStore["finalize"]>[0]): Promise<boolean> {
    const results = await this.sql.batch([
      auditInsertStatement(input.audit, {
        sql: `SELECT 1 FROM audit_archives
          WHERE id = ? AND status = 'pending' AND lease_token = ?`,
        params: [input.id, input.leaseToken],
      }),
      {
        method: "all",
        columns: ["archive_id"],
        sql: `UPDATE audit_archives
          SET status = 'ready', size_bytes = ?, sha256 = ?, completed_at = ?,
              lease_token = NULL, lease_expires_at = NULL
          WHERE id = ? AND status = 'pending' AND lease_token = ?
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING id AS archive_id`,
        params: [input.sizeBytes, input.sha256, input.completedAt, input.id, input.leaseToken, input.audit.eventId],
      },
      {
        method: "run",
        sql: `DELETE FROM audit_log
          WHERE id IN (SELECT audit_id FROM audit_archive_items WHERE archive_id = ?)
            AND EXISTS (
              SELECT 1 FROM audit_archives
              WHERE id = ? AND status = 'ready' AND size_bytes = ? AND sha256 = ?
            )`,
        params: [input.id, input.id, input.sizeBytes, input.sha256],
      },
    ]);
    return returnedRowCount(results[1]) === 1;
  }

  async inspectBacklog(before: string) {
    const pendingAt = allRows(await this.sql.execute({
      method: "all",
      columns: ["pending_at"],
      sql: `SELECT logs.occurred_at AS pending_at
        FROM audit_log AS logs
        WHERE logs.occurred_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM audit_archive_items AS claimed WHERE claimed.audit_id = logs.id
          )
        ORDER BY logs.occurred_at, logs.id
        LIMIT ?`,
      params: [before, SCHEDULED_BACKLOG_READ_LIMIT],
    })).map((row) => {
      const pendingAt = row[0];
      if (typeof pendingAt !== "string") throw corrupt("Invalid audit archive backlog projection");
      return pendingAt;
    });
    return observedBacklog(pendingAt);
  }

  async listMonths(): Promise<readonly string[]> {
    return allRows(await this.sql.execute({
      method: "all",
      sql: `SELECT DISTINCT month FROM audit_archives
        WHERE status = 'ready' ORDER BY month DESC LIMIT ?`,
      params: [MAX_ARCHIVE_MONTHS],
    })).map((row) => {
      const month = row[0];
      if (typeof month !== "string") throw corrupt("Invalid audit archive month");
      return month;
    });
  }

  async listReady(month: string): Promise<readonly AuditArchiveManifest[]> {
    return allRows(await this.sql.execute({
      method: "all",
      sql: `${manifestSelect()} WHERE status = 'ready' AND month = ?
        ORDER BY created_at, id LIMIT ?`,
      params: [month, MAX_ARCHIVE_FILES_PER_MONTH],
    })).map(mapManifest);
  }

  async getReady(id: string): Promise<AuditArchiveManifest | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${manifestSelect()} WHERE status = 'ready' AND id = ?`,
      params: [id],
    }));
    return row ? mapManifest(row) : null;
  }

  private async loadClaim(
    id: string,
    leaseToken: string,
    month: string,
    objectKey: string,
  ): Promise<AuditArchiveClaim> {
    const rows = allRows(await this.sql.execute({
      method: "all",
      sql: `SELECT logs.id, logs.request_id, logs.actor_kind, logs.actor_id, logs.actor_label,
          logs.subject_type, logs.subject_id, logs.subject_label, logs.action, logs.payload_json,
          logs.occurred_at
        FROM audit_archive_items AS items
        JOIN audit_archives AS archives ON archives.id = items.archive_id
        JOIN audit_log AS logs ON logs.id = items.audit_id
        WHERE archives.id = ? AND archives.status = 'pending' AND archives.lease_token = ?
        ORDER BY items.position`,
      params: [id, leaseToken],
    }));
    if (rows.length < 1 || rows.length > 100) throw corrupt("Invalid audit archive claim size");
    return { id, leaseToken, month, objectKey, entries: rows.map(mapAuditSqlRow) };
  }
}

function manifestSelect(): string {
  return `SELECT id, month, object_key, row_count, starts_at, ends_at,
    size_bytes, sha256, completed_at FROM audit_archives`;
}

function mapManifest(row: readonly SqlValue[]): AuditArchiveManifest {
  const [id, month, objectKey, rowCount, startsAt, endsAt, sizeBytes, sha256, completedAt] = row;
  if (typeof id !== "string" || typeof month !== "string" || typeof objectKey !== "string"
    || typeof rowCount !== "number" || typeof startsAt !== "string" || typeof endsAt !== "string"
    || typeof sizeBytes !== "number" || typeof sha256 !== "string" || typeof completedAt !== "string") {
    throw corrupt("Invalid audit archive manifest");
  }
  return { id, month, objectKey, rowCount, startsAt, endsAt, sizeBytes, sha256, completedAt };
}

function oneRow(result: SqlResult | undefined): readonly SqlValue[] | null {
  if (!result || result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw corrupt("Invalid SQLite get row");
  }
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw corrupt("Invalid SQLite row set");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
