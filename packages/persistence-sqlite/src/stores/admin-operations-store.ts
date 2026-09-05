import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  AdminOperationsJobStatusRead,
  AdminOperationsLeaseRead,
  AdminOperationsMediaStateUsage,
  AdminOperationsStore,
} from "@guild/server/modules/admin-operations";
import {
  SCHEDULED_JOB_NAMES,
  type ScheduledJobName,
  type ScheduledJobOutcome,
  type ScheduledJobStatusStore,
} from "@guild/server/modules/jobs";
import { ADMIN_OPERATION_MEDIA_STATES } from "@guild/shared/schemas/admin-operations";

const jobNames = new Set<string>(SCHEDULED_JOB_NAMES);
const mediaStates = new Set<string>(ADMIN_OPERATION_MEDIA_STATES);

export class SqliteAdminOperationsStore implements AdminOperationsStore, ScheduledJobStatusStore {
  constructor(private readonly sql: SqlExecutor) {}

  async recordRunning(input: Readonly<{ name: ScheduledJobName; startedAt: string }>): Promise<void> {
    assertJobName(input.name);
    assertIso(input.startedAt, "Scheduled job start time");
    await this.sql.execute({
      method: "run",
      sql: `INSERT INTO scheduled_job_statuses (
          job_name, status, started_at, finished_at, duration_ms, processed, batches, has_more,
          backlog_count_precision, backlog_pending_count, backlog_oldest_pending_at,
          backlog_reason, backlog_detail, error_summary
        ) VALUES (?, 'running', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
        ON CONFLICT(job_name) DO UPDATE SET
          status = 'running', started_at = excluded.started_at, finished_at = NULL, duration_ms = NULL,
          processed = NULL, batches = NULL, has_more = NULL, backlog_count_precision = NULL,
          backlog_pending_count = NULL, backlog_oldest_pending_at = NULL, backlog_reason = NULL,
          backlog_detail = NULL, error_summary = NULL`,
      params: [input.name, input.startedAt],
    });
  }

  async recordOutcome(input: Readonly<{
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    outcome: ScheduledJobOutcome;
  }>): Promise<void> {
    const { outcome } = input;
    assertJobName(outcome.name);
    assertIso(input.startedAt, "Scheduled job start time");
    assertIso(input.finishedAt, "Scheduled job finish time");
    assertCount(input.durationMs, "Scheduled job duration");
    const backlog = outcome.backlog;
    const params: SqlValue[] = [
      outcome.name,
      outcome.status,
      input.startedAt,
      input.finishedAt,
      input.durationMs,
      outcome.processed,
      outcome.batches,
      outcome.hasMore === null ? null : outcome.hasMore ? 1 : 0,
      backlog.countPrecision,
      backlog.pendingCount,
      backlog.oldestPendingAt,
      backlog.status === "unknown" ? backlog.reason : null,
      backlog.status === "unknown" ? backlog.detail ?? null : null,
      outcome.status === "failed" ? outcome.error : null,
    ];
    await this.sql.execute({
      method: "run",
      sql: `INSERT INTO scheduled_job_statuses (
          job_name, status, started_at, finished_at, duration_ms, processed, batches, has_more,
          backlog_count_precision, backlog_pending_count, backlog_oldest_pending_at,
          backlog_reason, backlog_detail, error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_name) DO UPDATE SET
          status = excluded.status, started_at = excluded.started_at, finished_at = excluded.finished_at,
          duration_ms = excluded.duration_ms, processed = excluded.processed, batches = excluded.batches,
          has_more = excluded.has_more, backlog_count_precision = excluded.backlog_count_precision,
          backlog_pending_count = excluded.backlog_pending_count,
          backlog_oldest_pending_at = excluded.backlog_oldest_pending_at,
          backlog_reason = excluded.backlog_reason, backlog_detail = excluded.backlog_detail,
          error_summary = excluded.error_summary
        WHERE NOT (
          scheduled_job_statuses.status = 'running'
          AND excluded.status = 'lease-held'
        )`,
      params,
    });
  }

  async read(observedAt: string) {
    assertIso(observedAt, "Admin operations observation time");
    const [statuses, leases, media, audit] = await this.sql.readBatch([
      {
        method: "all",
        columns: [
          "job_name", "status", "started_at", "finished_at", "duration_ms", "processed", "batches",
          "has_more", "backlog_count_precision", "backlog_pending_count", "backlog_oldest_pending_at",
          "backlog_reason", "backlog_detail", "error_summary",
        ],
        sql: `SELECT job_name, status, started_at, finished_at, duration_ms, processed, batches, has_more,
            backlog_count_precision, backlog_pending_count, backlog_oldest_pending_at,
            backlog_reason, backlog_detail, error_summary
          FROM scheduled_job_statuses ORDER BY job_name`,
      },
      {
        method: "all",
        columns: ["job_name", "acquired_at", "expires_at"],
        sql: `SELECT job_name, acquired_at, expires_at FROM scheduled_job_leases
          WHERE acquired_at <= ? AND expires_at > ? ORDER BY job_name`,
        params: [observedAt, observedAt],
      },
      {
        method: "all",
        columns: ["state", "asset_count", "variant_count", "logical_bytes"],
        sql: `SELECT assets.state, COUNT(DISTINCT assets.id) AS asset_count,
            COUNT(variants.object_key) AS variant_count,
            COALESCE(SUM(variants.byte_size), 0) AS logical_bytes
          FROM media_assets AS assets
          LEFT JOIN media_variants AS variants ON variants.media_id = assets.id
          GROUP BY assets.state ORDER BY assets.state`,
      },
      {
        method: "get",
        columns: ["log_count", "archive_count", "archive_bytes"],
        sql: `SELECT
            (SELECT COUNT(*) FROM audit_log) AS log_count,
            (SELECT COUNT(*) FROM audit_archives WHERE status = 'ready') AS archive_count,
            COALESCE((SELECT SUM(size_bytes) FROM audit_archives WHERE status = 'ready'), 0) AS archive_bytes`,
      },
    ]);
    const [auditLogCount, auditArchiveCount, auditArchiveBytes] = oneRow(required(audit, "audit usage"), "audit usage");
    return {
      statuses: allRows(required(statuses, "scheduled job status"), "scheduled job status").map(mapStatus),
      leases: allRows(required(leases, "scheduled job lease"), "scheduled job lease").map(mapLease),
      usage: {
        mediaByState: allRows(required(media, "media usage"), "media usage").map(mapMediaUsage),
        auditLogCount: count(auditLogCount, "Audit log count"),
        auditArchiveCount: count(auditArchiveCount, "Audit archive count"),
        auditArchiveBytes: count(auditArchiveBytes, "Audit archive bytes"),
      },
    };
  }
}

function mapStatus(row: readonly SqlValue[]): AdminOperationsJobStatusRead {
  const [
    name, status, startedAt, finishedAt, durationMs, processed, batches, hasMore,
    precision, pendingCount, oldestPendingAt, reason, detail, errorSummary,
  ] = row;
  assertJobName(name);
  if (status !== "running" && status !== "completed" && status !== "lease-held" && status !== "failed") {
    throw corrupt("Invalid scheduled job status");
  }
  if (typeof startedAt !== "string" || (finishedAt !== null && typeof finishedAt !== "string")) {
    throw corrupt("Invalid scheduled job timestamps");
  }
  assertIso(startedAt, "Scheduled job start time");
  if (finishedAt !== null) assertIso(finishedAt, "Scheduled job finish time");
  const backlog = precision === null ? null : precision === "unknown"
    ? {
        status: "unknown" as const,
        pendingCount: null,
        countPrecision: "unknown" as const,
        oldestPendingAt: null,
        reason: backlogReason(reason),
        ...(detail === null ? {} : { detail: text(detail, "Scheduled job backlog detail") }),
      }
    : {
        status: "known" as const,
        pendingCount: count(pendingCount, "Scheduled job backlog count"),
        countPrecision: knownPrecision(precision),
        oldestPendingAt: nullableText(oldestPendingAt, "Scheduled job oldest backlog timestamp"),
      };
  return {
    name,
    status,
    startedAt,
    finishedAt,
    durationMs: nullableCount(durationMs, "Scheduled job duration"),
    processed: nullableCount(processed, "Scheduled job processed count"),
    batches: nullableCount(batches, "Scheduled job batch count"),
    hasMore: nullableBoolean(hasMore, "Scheduled job has-more value"),
    backlog,
    errorSummary: nullableText(errorSummary, "Scheduled job error summary"),
  };
}

function mapLease(row: readonly SqlValue[]): AdminOperationsLeaseRead {
  const [name, acquiredAt, expiresAt] = row;
  assertJobName(name);
  if (typeof acquiredAt !== "string" || typeof expiresAt !== "string") throw corrupt("Invalid scheduled job lease");
  assertIso(acquiredAt, "Scheduled job lease acquisition time");
  assertIso(expiresAt, "Scheduled job lease expiry time");
  return { name, acquiredAt, expiresAt };
}

function mapMediaUsage(row: readonly SqlValue[]): AdminOperationsMediaStateUsage {
  const [state, assetCount, variantCount, logicalBytes] = row;
  if (typeof state !== "string" || !mediaStates.has(state)) throw corrupt("Invalid media usage state");
  return {
    state: state as AdminOperationsMediaStateUsage["state"],
    assetCount: count(assetCount, "Media asset count"),
    variantCount: count(variantCount, "Media variant count"),
    logicalBytes: count(logicalBytes, "Media logical bytes"),
  };
}

function assertJobName(value: unknown): asserts value is ScheduledJobName {
  if (typeof value !== "string" || !jobNames.has(value)) throw corrupt("Invalid scheduled job name");
}

function assertIso(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw corrupt(`${field} is invalid`);
  }
}

function assertCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw corrupt(`${field} is invalid`);
}

function count(value: SqlValue | undefined, field: string): number {
  if (typeof value !== "number") throw corrupt(`${field} is invalid`);
  assertCount(value, field);
  return value;
}

function nullableCount(value: SqlValue | undefined, field: string): number | null {
  return value === null ? null : count(value, field);
}

function nullableBoolean(value: SqlValue | undefined, field: string): boolean | null {
  if (value === null) return null;
  if (value !== 0 && value !== 1) throw corrupt(`${field} is invalid`);
  return value === 1;
}

function text(value: SqlValue | undefined, field: string): string {
  if (typeof value !== "string" || !value) throw corrupt(`${field} is invalid`);
  return value;
}

function nullableText(value: SqlValue | undefined, field: string): string | null {
  return value === null ? null : text(value, field);
}

function knownPrecision(value: SqlValue | undefined): "exact" | "at-least" {
  if (value !== "exact" && value !== "at-least") throw corrupt("Invalid scheduled job backlog precision");
  return value;
}

function backlogReason(value: SqlValue | undefined): "lease-held" | "unsupported" | "inspection-failed" | "job-failed" {
  if (value !== "lease-held" && value !== "unsupported" && value !== "inspection-failed" && value !== "job-failed") {
    throw corrupt("Invalid scheduled job backlog reason");
  }
  return value;
}

function allRows(result: SqlResult, label: string): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw corrupt(`Invalid ${label} row set`);
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function required(result: SqlResult | undefined, label: string): SqlResult {
  if (!result) throw corrupt(`Missing ${label} result`);
  return result;
}

function oneRow(result: SqlResult, label: string): readonly SqlValue[] {
  if (!Array.isArray(result.rows) || Array.isArray(result.rows[0])) throw corrupt(`Invalid ${label} row`);
  return result.rows;
}

function corrupt(message: string): TypeError {
  return new TypeError(message);
}
