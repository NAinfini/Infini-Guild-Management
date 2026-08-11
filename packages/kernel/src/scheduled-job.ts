export type ScheduledJobBacklog = Readonly<{
  status: "known";
  pendingCount: number;
  countPrecision: "exact" | "at-least";
  oldestPendingAt: string | null;
}> | Readonly<{
  status: "unknown";
  pendingCount: null;
  countPrecision: "unknown";
  oldestPendingAt: null;
  reason: "lease-held" | "unsupported" | "inspection-failed" | "job-failed";
  detail?: string;
}>;
