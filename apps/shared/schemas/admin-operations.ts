import { z } from "zod";

export const ADMIN_OPERATION_JOB_NAMES = [
  "recurrence-materialization",
  "announcement-publish",
  "raffle-auto-draw",
  "event-auto-archive",
  "media-gc",
  "audit-archive",
  "session-cleanup",
  "system-test-cleanup",
] as const;

export const ADMIN_OPERATION_MEDIA_STATES = [
  "uploading",
  "staged",
  "attached",
  "deleting",
] as const;

export const ADMIN_OPERATION_JOB_SCHEDULES = [
  "quarter-hourly",
  "half-hourly",
  "hourly-media",
  "hourly-cleanup",
  "daily",
] as const;

const timestampSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const adminOperationJobNameSchema = z.enum(ADMIN_OPERATION_JOB_NAMES);
export const adminOperationJobStatusSchema = z.enum([
  "never-run",
  "running",
  "interrupted",
  "completed",
  "lease-held",
  "failed",
]);

export const adminOperationBacklogSchema = z.object({
  count_precision: z.enum(["exact", "at-least", "unknown"]),
  pending_count: countSchema.nullable(),
  oldest_pending_at: timestampSchema.nullable(),
  reason: z.enum(["lease-held", "unsupported", "inspection-failed", "job-failed"]).nullable(),
  detail: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const adminOperationLeaseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z.object({
    state: z.literal("held"),
    acquired_at: timestampSchema,
    expires_at: timestampSchema,
  }).strict(),
]);

export const adminOperationScheduledJobSchema = z.object({
  name: adminOperationJobNameSchema,
  schedule: z.enum(ADMIN_OPERATION_JOB_SCHEDULES),
  status: adminOperationJobStatusSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema.nullable(),
  duration_ms: countSchema.nullable(),
  processed: countSchema.nullable(),
  batches: countSchema.nullable(),
  has_more: z.boolean().nullable(),
  backlog: adminOperationBacklogSchema.nullable(),
  error_summary: z.string().trim().min(1).max(500).nullable(),
  lease: adminOperationLeaseSchema,
}).strict();

const runtimeSourceSchema = z.enum(["cloudflare-notifications-do", "vps-notification-hub"]);

export const adminOperationRealtimeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    runtime_source: runtimeSourceSchema,
    observed_at: timestampSchema,
    connection_count: countSchema,
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    runtime_source: runtimeSourceSchema,
    observed_at: timestampSchema,
    connection_count: z.null(),
  }).strict(),
]);

export const adminOperationMediaStateUsageSchema = z.object({
  state: z.enum(ADMIN_OPERATION_MEDIA_STATES),
  asset_count: countSchema,
  variant_count: countSchema,
  logical_bytes: countSchema,
}).strict();

export const adminOperationsResponseSchema = z.object({
  observed_at: timestampSchema,
  scheduled_jobs: z.array(adminOperationScheduledJobSchema).length(ADMIN_OPERATION_JOB_NAMES.length),
  realtime: adminOperationRealtimeSchema,
  managed_data_usage: z.object({
    media: z.object({
      asset_count: countSchema,
      variant_count: countSchema,
      logical_bytes: countSchema,
      by_state: z.array(adminOperationMediaStateUsageSchema).length(ADMIN_OPERATION_MEDIA_STATES.length),
    }).strict(),
    audit: z.object({
      log_count: countSchema,
      archive_count: countSchema,
      archive_bytes: countSchema,
    }).strict(),
  }).strict(),
}).strict();

export type AdminOperationJobName = z.infer<typeof adminOperationJobNameSchema>;
export type AdminOperationJobStatus = z.infer<typeof adminOperationJobStatusSchema>;
export type AdminOperationsResponse = z.infer<typeof adminOperationsResponseSchema>;
