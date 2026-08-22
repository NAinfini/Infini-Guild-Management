import type { AdminOperationsService } from "@guild/server/modules/admin-operations";
import { adminOperationsResponseSchema } from "@guild/shared/schemas/admin-operations";

type AdminOperationsRead = Awaited<ReturnType<AdminOperationsService["read"]>>;

export function presentAdminOperations(value: AdminOperationsRead) {
  return adminOperationsResponseSchema.parse({
    observed_at: value.observedAt,
    scheduled_jobs: value.scheduledJobs.map((job) => ({
      name: job.name,
      schedule: job.schedule,
      status: job.status,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      duration_ms: job.durationMs,
      processed: job.processed,
      batches: job.batches,
      has_more: job.hasMore,
      backlog: job.backlog && {
        count_precision: job.backlog.countPrecision,
        pending_count: job.backlog.pendingCount,
        oldest_pending_at: job.backlog.oldestPendingAt,
        reason: job.backlog.status === "unknown" ? job.backlog.reason : null,
        detail: job.backlog.status === "unknown" ? job.backlog.detail ?? null : null,
      },
      error_summary: job.errorSummary,
      lease: job.lease.state === "held"
        ? { state: "held", acquired_at: job.lease.acquiredAt, expires_at: job.lease.expiresAt }
        : { state: "none" },
    })),
    realtime: {
      state: value.realtime.state,
      runtime_source: value.realtime.runtimeSource,
      observed_at: value.realtime.observedAt,
      connection_count: value.realtime.connectionCount,
    },
    managed_data_usage: {
      media: {
        asset_count: value.managedDataUsage.media.assetCount,
        variant_count: value.managedDataUsage.media.variantCount,
        logical_bytes: value.managedDataUsage.media.logicalBytes,
        by_state: value.managedDataUsage.media.byState.map((usage) => ({
          state: usage.state,
          asset_count: usage.assetCount,
          variant_count: usage.variantCount,
          logical_bytes: usage.logicalBytes,
        })),
      },
      audit: {
        log_count: value.managedDataUsage.audit.logCount,
        archive_count: value.managedDataUsage.audit.archiveCount,
        archive_bytes: value.managedDataUsage.audit.archiveBytes,
      },
    },
  });
}
