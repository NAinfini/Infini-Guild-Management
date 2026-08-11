import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ScheduledJobCoordinator,
  ScheduledJobOutcome,
  ScheduledJobSchedule,
} from "@guild/server";
import { VpsScheduledJobScheduler } from "./scheduled-job-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("VpsScheduledJobScheduler", () => {
  it("aligns to the next quarter-hour and waits for active work during stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:01.000Z"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runSchedule = vi.fn(async (
      _schedule: ScheduledJobSchedule,
    ): Promise<readonly ScheduledJobOutcome[]> => {
      await blocked;
      return [{
        name: "session-cleanup",
        status: "completed",
        processed: 1,
        hasMore: false,
        batches: 1,
        backlog: {
          status: "known",
          pendingCount: 0,
          countPrecision: "exact",
          oldestPendingAt: null,
        },
      }];
    });
    const onOutcome = vi.fn();
    const scheduler = new VpsScheduledJobScheduler({
      runSchedule,
    } satisfies Pick<ScheduledJobCoordinator, "runSchedule">, { onOutcome });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1_000);
    expect(runSchedule).toHaveBeenCalledWith("quarter-hourly");
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ name: "session-cleanup", status: "completed" }),
      "quarter-hourly",
    );
  });
});
