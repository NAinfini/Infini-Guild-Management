import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_SCHEDULED_CRONS,
  dispatchCloudflareScheduledJobs,
} from "./scheduled-dispatcher.js";

describe("dispatchCloudflareScheduledJobs", () => {
  it("routes only the five staggered cron expressions into the shared coordinator", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const runSchedule = vi.fn().mockResolvedValue([{
      name: "session-cleanup",
      status: "completed",
      processed: 2,
      hasMore: false,
      batches: 1,
      backlog: {
        status: "known",
        pendingCount: 0,
        countPrecision: "exact",
        oldestPendingAt: null,
      },
    }]);
    const pending: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };

    expect(dispatchCloudflareScheduledJobs(
      { cron: CLOUDFLARE_SCHEDULED_CRONS["quarter-hourly"] }, context, { runSchedule } as never,
    )).toBe(true);
    expect(dispatchCloudflareScheduledJobs(
      { cron: CLOUDFLARE_SCHEDULED_CRONS["half-hourly"] }, context, { runSchedule } as never,
    )).toBe(true);
    expect(dispatchCloudflareScheduledJobs(
      { cron: CLOUDFLARE_SCHEDULED_CRONS["hourly-media"] }, context, { runSchedule } as never,
    )).toBe(true);
    expect(dispatchCloudflareScheduledJobs(
      { cron: CLOUDFLARE_SCHEDULED_CRONS["hourly-cleanup"] }, context, { runSchedule } as never,
    )).toBe(true);
    expect(dispatchCloudflareScheduledJobs(
      { cron: CLOUDFLARE_SCHEDULED_CRONS.daily }, context, { runSchedule } as never,
    )).toBe(true);
    expect(dispatchCloudflareScheduledJobs({ cron: "1 2 3 4 5" }, context, { runSchedule } as never)).toBe(false);
    await Promise.all(pending);
    expect(runSchedule.mock.calls.map(([schedule]) => schedule)).toEqual([
      "quarter-hourly",
      "half-hourly",
      "hourly-media",
      "hourly-cleanup",
      "daily",
    ]);
    expect(info).toHaveBeenCalledWith(
      "Cloudflare scheduled job completed",
      expect.objectContaining({ schedule: "quarter-hourly", name: "session-cleanup" }),
    );
    info.mockRestore();
  });
});
