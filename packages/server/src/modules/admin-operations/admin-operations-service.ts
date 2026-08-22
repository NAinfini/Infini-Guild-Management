import type { RequestContext } from "@guild/kernel";
import {
  ADMIN_OPERATION_JOB_NAMES,
  ADMIN_OPERATION_MEDIA_STATES,
} from "@guild/shared/schemas/admin-operations";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { SCHEDULED_JOB_GROUPS } from "../jobs/public.js";
import type {
  AdminOperationsRuntimePort,
  AdminOperationsStore,
} from "./model.js";

const dailyJobs = new Set<string>(SCHEDULED_JOB_GROUPS.daily);

export class AdminOperationsService {
  constructor(
    private readonly store: AdminOperationsStore,
    private readonly runtime: AdminOperationsRuntimePort,
  ) {}

  async read(context: RequestContext) {
    context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    const [snapshot, realtime] = await Promise.all([
      this.store.read(context.now),
      this.runtime.readRealtime(),
    ]);
    const statuses = new Map(snapshot.statuses.map((status) => [status.name, status]));
    const leases = new Map(snapshot.leases.map((lease) => [lease.name, lease]));
    const usageByState = new Map(snapshot.usage.mediaByState.map((usage) => [usage.state, usage]));
    const mediaByState = ADMIN_OPERATION_MEDIA_STATES.map((state) => usageByState.get(state) ?? {
      state,
      assetCount: 0,
      variantCount: 0,
      logicalBytes: 0,
    });

    return {
      observedAt: context.now,
      scheduledJobs: ADMIN_OPERATION_JOB_NAMES.map((name) => {
        const status = statuses.get(name);
        const lease = leases.get(name);
        const isRunning = lease !== undefined;
        return {
          name,
          schedule: dailyJobs.has(name) ? "daily" as const : "quarter-hourly" as const,
          status: isRunning
            ? "running" as const
            : status?.status === "running"
              ? "interrupted" as const
              : status?.status ?? "never-run" as const,
          startedAt: lease ? lease.acquiredAt : status?.startedAt ?? null,
          finishedAt: isRunning ? null : status?.finishedAt ?? null,
          durationMs: isRunning ? null : status?.durationMs ?? null,
          processed: isRunning ? null : status?.processed ?? null,
          batches: isRunning ? null : status?.batches ?? null,
          hasMore: isRunning ? null : status?.hasMore ?? null,
          backlog: isRunning ? null : status?.backlog ?? null,
          errorSummary: isRunning ? null : status?.errorSummary ?? null,
          lease: lease
            ? { state: "held" as const, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt }
            : { state: "none" as const },
        };
      }),
      realtime,
      managedDataUsage: {
        media: {
          assetCount: mediaByState.reduce((total, usage) => total + usage.assetCount, 0),
          variantCount: mediaByState.reduce((total, usage) => total + usage.variantCount, 0),
          logicalBytes: mediaByState.reduce((total, usage) => total + usage.logicalBytes, 0),
          byState: mediaByState,
        },
        audit: {
          logCount: snapshot.usage.auditLogCount,
          archiveCount: snapshot.usage.auditArchiveCount,
          archiveBytes: snapshot.usage.auditArchiveBytes,
        },
      },
    };
  }
}
