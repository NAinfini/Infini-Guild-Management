import type { ScheduledJobBacklog } from "@guild/kernel";
import type {
  AdminOperationJobName,
  AdminOperationJobStatus,
} from "@guild/shared/schemas/admin-operations";

export type AdminOperationsJobStatusRead = Readonly<{
  name: AdminOperationJobName;
  status: Exclude<AdminOperationJobStatus, "never-run" | "interrupted">;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  processed: number | null;
  batches: number | null;
  hasMore: boolean | null;
  backlog: ScheduledJobBacklog | null;
  errorSummary: string | null;
}>;

export type AdminOperationsLeaseRead = Readonly<{
  name: AdminOperationJobName;
  acquiredAt: string;
  expiresAt: string;
}>;

export type AdminOperationsMediaStateUsage = Readonly<{
  state: "uploading" | "staged" | "attached" | "deleting";
  assetCount: number;
  variantCount: number;
  logicalBytes: number;
}>;

export type AdminOperationsUsageRead = Readonly<{
  mediaByState: readonly AdminOperationsMediaStateUsage[];
  auditLogCount: number;
  auditArchiveCount: number;
  auditArchiveBytes: number;
}>;

export interface AdminOperationsStore {
  read(observedAt: string): Promise<Readonly<{
    statuses: readonly AdminOperationsJobStatusRead[];
    leases: readonly AdminOperationsLeaseRead[];
    usage: AdminOperationsUsageRead;
  }>>;
}

type AdminOperationsRuntimeSource = "cloudflare-notifications-do" | "vps-notification-hub";

export type AdminOperationsRealtimeRead = Readonly<{
  state: "available";
  runtimeSource: AdminOperationsRuntimeSource;
  observedAt: string;
  connectionCount: number;
}> | Readonly<{
  state: "unavailable";
  runtimeSource: AdminOperationsRuntimeSource;
  observedAt: string;
  connectionCount: null;
}>;

export interface AdminOperationsRuntimePort {
  readRealtime(): Promise<AdminOperationsRealtimeRead>;
}
