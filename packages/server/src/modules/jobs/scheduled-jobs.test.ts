import { describe, expect, it, vi } from "vitest";
import {
  SCHEDULED_JOB_LIMITS,
  SCHEDULER_SYSTEM_ACTOR_ID,
  ScheduledJobCoordinator,
  createSchedulerAuditFactory,
  type ScheduledJobCoordinatorDependencies,
} from "./scheduled-jobs.js";

function batch(processed = 1, hasMore = false) {
  return Promise.resolve({ processed, hasMore });
}

const emptyBacklog = {
  status: "known" as const,
  pendingCount: 0,
  countPrecision: "exact" as const,
  oldestPendingAt: null,
};

function createDependencies(): ScheduledJobCoordinatorDependencies {
  return {
    leases: {
      tryAcquire: vi.fn().mockResolvedValue(true),
      renew: vi.fn().mockResolvedValue(true),
      readCursor: vi.fn().mockResolvedValue(null),
      writeCursor: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    },
    statuses: {
      recordRunning: vi.fn().mockResolvedValue(undefined),
      recordOutcome: vi.fn().mockResolvedValue(undefined),
    },
    recurrenceMaterialization: {
      run: vi.fn().mockResolvedValue({ processed: 1, hasMore: false, nextTemplateCursor: null }),
      inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog),
    },
    announcementPublish: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    raffleAutoDraw: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    eventAutoArchive: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    mediaGarbageCollection: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    auditArchive: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    sessionCleanup: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    systemTestCleanup: { run: vi.fn(() => batch()), inspectBacklog: vi.fn().mockResolvedValue(emptyBacklog) },
    now: () => new Date("2026-08-09T00:00:00.000Z"),
    createLeaseToken: () => "lease-token-00000001",
  };
}

describe("ScheduledJobCoordinator", () => {
  it("runs the shared quarter-hourly jobs sequentially with bounded inputs and a system audit actor", async () => {
    const dependencies = createDependencies();
    const outcomes = await new ScheduledJobCoordinator(dependencies).runSchedule("quarter-hourly");

    expect(outcomes.map(({ name }) => name)).toEqual([
      "recurrence-materialization",
      "announcement-publish",
      "raffle-auto-draw",
      "session-cleanup",
      "system-test-cleanup",
      "event-auto-archive",
      "media-gc",
    ]);
    const recurrenceInput = vi.mocked(dependencies.recurrenceMaterialization.run).mock.calls[0]![0];
    expect(recurrenceInput).toMatchObject({
      afterTemplateId: null,
      maxTemplates: SCHEDULED_JOB_LIMITS.recurrenceMaterialization.templates,
      maxOccurrencesPerTemplate: SCHEDULED_JOB_LIMITS.recurrenceMaterialization.occurrencesPerTemplate,
    });
    const audit = recurrenceInput.audit({
      subjectType: "event",
      subjectId: "event-1",
      action: "create",
    });
    expect(audit.actorId).toBe(SCHEDULER_SYSTEM_ACTOR_ID);
    expect(audit.requestId).toBe("scheduled:lease-token-00000001");
    expect(vi.mocked(dependencies.sessionCleanup.run).mock.calls[0]![0]).toMatchObject({
      expiresBefore: "2026-08-09T00:00:00.000Z",
      createdBefore: "2026-05-11T00:00:00.000Z",
      limit: SCHEDULED_JOB_LIMITS.sessionCleanup,
    });
    expect(vi.mocked(dependencies.eventAutoArchive.run).mock.calls[0]![0].limit)
      .toBe(SCHEDULED_JOB_LIMITS.eventAutoArchive);
    expect(vi.mocked(dependencies.announcementPublish.run).mock.calls[0]![0].limit)
      .toBe(SCHEDULED_JOB_LIMITS.announcementPublish);
    expect(vi.mocked(dependencies.raffleAutoDraw.run).mock.calls[0]![0].limit)
      .toBe(SCHEDULED_JOB_LIMITS.raffleAutoDraw);
    expect(dependencies.systemTestCleanup.run).toHaveBeenCalledWith({
      before: "2026-08-09T00:00:00.000Z",
      limit: SCHEDULED_JOB_LIMITS.systemTestCleanup,
    });
    expect(vi.mocked(dependencies.mediaGarbageCollection.run).mock.calls[0]![0].limit)
      .toBe(SCHEDULED_JOB_LIMITS.mediaGarbageCollection);
    expect(dependencies.leases.release).toHaveBeenCalledTimes(7);
    expect(dependencies.leases.writeCursor).toHaveBeenCalledWith(
      "recurrence-materialization",
      "lease-token-00000001",
      null,
      "2026-08-09T00:00:00.000Z",
    );
    expect(outcomes.every(({ backlog }) => backlog.status === "known")).toBe(true);
    expect(dependencies.statuses.recordRunning).toHaveBeenCalledTimes(7);
    expect(dependencies.statuses.recordOutcome).toHaveBeenCalledTimes(7);
  });

  it("uses a three-full-month cutoff for the bounded daily audit batch", async () => {
    const dependencies = createDependencies();
    await new ScheduledJobCoordinator(dependencies).runSchedule("daily");
    expect(dependencies.auditArchive.run).toHaveBeenCalledWith(expect.objectContaining({
      before: "2026-05-01T00:00:00.000Z",
      now: "2026-08-09T00:00:00.000Z",
      limit: SCHEDULED_JOB_LIMITS.auditArchive,
    }));
  });

  it("skips a held lease and rejects a job that violates its bound", async () => {
    const held = createDependencies();
    vi.mocked(held.leases.tryAcquire).mockResolvedValue(false);
    await expect(new ScheduledJobCoordinator(held).run("media-gc")).resolves.toMatchObject({
      status: "lease-held",
      processed: 0,
    });
    expect(held.statuses.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ name: "media-gc", status: "lease-held" }),
    }));
    expect(held.mediaGarbageCollection.run).not.toHaveBeenCalled();

    const overflowing = createDependencies();
    vi.mocked(overflowing.eventAutoArchive.run).mockResolvedValue({ processed: 101, hasMore: true });
    await expect(new ScheduledJobCoordinator(overflowing).run("event-auto-archive"))
      .rejects.toThrow("outside its configured batch limit");
    expect(overflowing.leases.release).toHaveBeenCalledOnce();
  });

  it("drains remaining work within one lease and renews between batches", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.mediaGarbageCollection.run)
      .mockResolvedValueOnce({ processed: 50, hasMore: true })
      .mockResolvedValueOnce({ processed: 7, hasMore: false });

    await expect(new ScheduledJobCoordinator(dependencies).run("media-gc")).resolves.toMatchObject({
      status: "completed",
      processed: 57,
      hasMore: false,
      batches: 2,
    });
    expect(dependencies.mediaGarbageCollection.run).toHaveBeenCalledTimes(2);
    expect(dependencies.leases.renew).toHaveBeenCalledOnce();
  });

  it("drains scheduled publications through the shared leased batch loop", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.announcementPublish.run)
      .mockResolvedValueOnce({ processed: 50, hasMore: true })
      .mockResolvedValueOnce({ processed: 2, hasMore: false });

    await expect(new ScheduledJobCoordinator(dependencies).run("announcement-publish"))
      .resolves.toMatchObject({ processed: 52, hasMore: false, batches: 2 });
    expect(dependencies.announcementPublish.run).toHaveBeenCalledTimes(2);
    expect(dependencies.leases.renew).toHaveBeenCalledOnce();
  });

  it("leaves hasMore set when the bounded run budget is exhausted", async () => {
    const dependencies = { ...createDependencies(), monotonicNow: () => 0 };
    vi.mocked(dependencies.sessionCleanup.run).mockResolvedValue({ processed: 500, hasMore: true });

    await expect(new ScheduledJobCoordinator(dependencies).run("session-cleanup")).resolves.toMatchObject({
      processed: 4_000,
      hasMore: true,
      batches: 8,
    });
    expect(dependencies.sessionCleanup.run).toHaveBeenCalledTimes(8);
    expect(dependencies.leases.renew).toHaveBeenCalledTimes(7);
  });

  it("isolates a failed job and reports backlog inspection failures explicitly", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.recurrenceMaterialization.run).mockRejectedValue(new Error("recurrence failed"));
    vi.mocked(dependencies.sessionCleanup.inspectBacklog).mockRejectedValue(new Error("backlog unavailable"));

    const outcomes = await new ScheduledJobCoordinator(dependencies).runSchedule("quarter-hourly");

    expect(outcomes[0]).toMatchObject({
      name: "recurrence-materialization",
      status: "failed",
      processed: null,
      backlog: { status: "unknown", reason: "job-failed" },
    });
    expect(dependencies.statuses.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        name: "recurrence-materialization",
        status: "failed",
        error: "recurrence failed",
      }),
    }));
    expect(outcomes[3]).toMatchObject({
      name: "session-cleanup",
      status: "completed",
      backlog: { status: "unknown", reason: "inspection-failed", detail: "backlog unavailable" },
    });
    expect(dependencies.systemTestCleanup.run).toHaveBeenCalledOnce();
    expect(outcomes).toHaveLength(7);
  });

  it("creates scheduler audit entries without an authenticated-user context", () => {
    const audit = createSchedulerAuditFactory("run-1", "2026-08-09T00:00:00.000Z")({
      subjectType: "media_cleanup",
      subjectId: "run-1",
      action: "run",
    });
    expect(audit).toMatchObject({
      actorId: "system:scheduler",
      requestId: "scheduled:run-1",
    });
  });

  it("renews a running lease before its original expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
      const dependencies = { ...createDependencies(), now: () => new Date() };
      let finish!: () => void;
      const blocked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      vi.mocked(dependencies.mediaGarbageCollection.run).mockImplementation(async () => {
        await blocked;
        return { processed: 1, hasMore: false };
      });

      const running = new ScheduledJobCoordinator(dependencies).run("media-gc");
      await vi.advanceTimersByTimeAsync(Math.floor((10 * 60_000) / 3));
      expect(dependencies.leases.renew).toHaveBeenCalledWith({
        jobName: "media-gc",
        leaseToken: "lease-token-00000001",
        renewedAt: "2026-08-09T00:03:20.000Z",
        expiresAt: "2026-08-09T00:13:20.000Z",
      });
      finish();
      await expect(running).resolves.toMatchObject({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });
});
