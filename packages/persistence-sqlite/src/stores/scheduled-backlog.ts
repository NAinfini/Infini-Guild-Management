import type { ScheduledJobBacklog } from "@guild/kernel";

export const SCHEDULED_BACKLOG_READ_LIMIT = 1_001;

export function observedBacklog(
  pendingAt: readonly string[],
  sourceWasTruncated = pendingAt.length === SCHEDULED_BACKLOG_READ_LIMIT,
): ScheduledJobBacklog {
  const oldestPendingAt = pendingAt[0] ?? null;
  if (pendingAt.some((value) => !Number.isFinite(Date.parse(value)))) {
    throw new TypeError("SQLite returned an invalid scheduled-job backlog timestamp");
  }
  return {
    status: "known",
    pendingCount: pendingAt.length,
    countPrecision: sourceWasTruncated ? "at-least" : "exact",
    oldestPendingAt,
  };
}
