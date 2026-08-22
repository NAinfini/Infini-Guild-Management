import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  SCHEDULED_JOB_NAMES,
  type ScheduledJobName,
} from "@guild/server/modules/jobs";

const jobNameIds = [...SCHEDULED_JOB_NAMES] as [ScheduledJobName, ...ScheduledJobName[]];
const jobNameValues = sql.raw(SCHEDULED_JOB_NAMES.map((name) => `'${name}'`).join(", "));

export const scheduledJobLeases = sqliteTable(
  "scheduled_job_leases",
  {
    jobName: text("job_name", { enum: jobNameIds }).primaryKey(),
    leaseToken: text("lease_token").notNull(),
    acquiredAt: text("acquired_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    cursorValue: text("cursor_value"),
  },
  (table) => [
    check("scheduled_job_leases_job_name_valid", sql`${table.jobName} IN (${jobNameValues})`),
    check(
      "scheduled_job_leases_lease_token_valid",
      sql`length(${table.leaseToken}) BETWEEN 16 AND 128`,
    ),
    check("scheduled_job_leases_interval_valid", sql`${table.acquiredAt} < ${table.expiresAt}`),
  ],
);

export const scheduledJobStatuses = sqliteTable(
  "scheduled_job_statuses",
  {
    jobName: text("job_name", { enum: jobNameIds }).primaryKey(),
    status: text("status", { enum: ["running", "completed", "lease-held", "failed"] }).notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    processed: integer("processed"),
    batches: integer("batches"),
    hasMore: integer("has_more", { mode: "boolean" }),
    backlogCountPrecision: text("backlog_count_precision", { enum: ["exact", "at-least", "unknown"] }),
    backlogPendingCount: integer("backlog_pending_count"),
    backlogOldestPendingAt: text("backlog_oldest_pending_at"),
    backlogReason: text("backlog_reason", {
      enum: ["lease-held", "unsupported", "inspection-failed", "job-failed"],
    }),
    backlogDetail: text("backlog_detail"),
    errorSummary: text("error_summary"),
  },
  (table) => [
    check("scheduled_job_statuses_job_name_valid", sql`${table.jobName} IN (${jobNameValues})`),
    check("scheduled_job_statuses_status_valid", sql`${table.status} IN ('running', 'completed', 'lease-held', 'failed')`),
    check("scheduled_job_statuses_duration_valid", sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`),
    check("scheduled_job_statuses_processed_valid", sql`${table.processed} IS NULL OR ${table.processed} >= 0`),
    check("scheduled_job_statuses_batches_valid", sql`${table.batches} IS NULL OR ${table.batches} >= 0`),
    check("scheduled_job_statuses_backlog_count_valid", sql`${table.backlogPendingCount} IS NULL OR ${table.backlogPendingCount} >= 0`),
    check(
      "scheduled_job_statuses_backlog_valid",
      sql`(
        ${table.backlogCountPrecision} IS NULL
        AND ${table.backlogPendingCount} IS NULL
        AND ${table.backlogOldestPendingAt} IS NULL
        AND ${table.backlogReason} IS NULL
        AND ${table.backlogDetail} IS NULL
      ) OR (
        ${table.backlogCountPrecision} = 'unknown'
        AND ${table.backlogPendingCount} IS NULL
        AND ${table.backlogOldestPendingAt} IS NULL
        AND ${table.backlogReason} IS NOT NULL
        AND (${table.backlogDetail} IS NULL OR length(${table.backlogDetail}) BETWEEN 1 AND 500)
      ) OR (
        ${table.backlogCountPrecision} IN ('exact', 'at-least')
        AND ${table.backlogPendingCount} IS NOT NULL
        AND ((${table.backlogPendingCount} = 0 AND ${table.backlogOldestPendingAt} IS NULL)
          OR (${table.backlogPendingCount} > 0 AND ${table.backlogOldestPendingAt} IS NOT NULL))
        AND ${table.backlogReason} IS NULL
        AND ${table.backlogDetail} IS NULL
      )`,
    ),
    check(
      "scheduled_job_statuses_state_valid",
      sql`(
        ${table.status} = 'running'
        AND ${table.finishedAt} IS NULL
        AND ${table.durationMs} IS NULL
        AND ${table.processed} IS NULL
        AND ${table.batches} IS NULL
        AND ${table.hasMore} IS NULL
        AND ${table.backlogCountPrecision} IS NULL
        AND ${table.errorSummary} IS NULL
      ) OR (
        ${table.status} = 'completed'
        AND ${table.finishedAt} IS NOT NULL
        AND ${table.durationMs} IS NOT NULL
        AND ${table.processed} IS NOT NULL
        AND ${table.batches} IS NOT NULL
        AND ${table.hasMore} IS NOT NULL
        AND ${table.backlogCountPrecision} IS NOT NULL
        AND ${table.errorSummary} IS NULL
      ) OR (
        ${table.status} = 'lease-held'
        AND ${table.finishedAt} IS NOT NULL
        AND ${table.durationMs} IS NOT NULL
        AND ${table.processed} = 0
        AND ${table.batches} = 0
        AND ${table.hasMore} = 1
        AND ${table.backlogCountPrecision} = 'unknown'
        AND ${table.backlogReason} = 'lease-held'
        AND ${table.errorSummary} IS NULL
      ) OR (
        ${table.status} = 'failed'
        AND ${table.finishedAt} IS NOT NULL
        AND ${table.durationMs} IS NOT NULL
        AND ${table.processed} IS NULL
        AND ${table.batches} IS NULL
        AND ${table.hasMore} IS NULL
        AND ${table.backlogCountPrecision} = 'unknown'
        AND ${table.backlogReason} = 'job-failed'
        AND length(${table.errorSummary}) BETWEEN 1 AND 500
      )`,
    ),
  ],
);
