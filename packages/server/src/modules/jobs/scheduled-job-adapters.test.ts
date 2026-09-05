import { describe, expect, it, vi } from "vitest";
import { AppError, type RequestContext } from "@guild/kernel";
import type { MaterializationAuditFactory } from "@guild/server/modules/events";
import { MEDIA_GARBAGE_COLLECTION_BATCH_SIZE } from "@guild/server/modules/media";
import { createSchedulerAuditFactory, SCHEDULED_JOB_LIMITS } from "./scheduled-jobs.js";
import {
  ScheduledAuditArchiveJob,
  ScheduledAnnouncementPublishJob,
  ScheduledEventAutoArchiveJob,
  ScheduledMediaGarbageCollectionJob,
  ScheduledRecurrenceMaterializationJob,
  ScheduledRaffleAutoDrawJob,
  ScheduledSystemTestCleanupJob,
  type BoundedAnnouncementPublishStore,
} from "./scheduled-job-adapters.js";

const NOW = "2026-08-09T00:00:00.000Z";
const backlog = {
  status: "known" as const,
  pendingCount: 1,
  countPrecision: "exact" as const,
  oldestPendingAt: "2026-08-01T00:00:00.000Z",
};

describe("scheduled job domain adapters", () => {
  it("materializes a bounded recurrence batch with system audits and event hints", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const materializeDueBatch = vi.fn(async (
      _now: string,
      afterTemplateId: string | null,
      _maxTemplates: number,
      _maxOccurrences: number,
      audit: MaterializationAuditFactory,
    ) => {
      expect(afterTemplateId).toBe("template-000");
      expect(audit({ subjectType: "event", subjectId: "event-1", action: "create" })).toMatchObject({ actorId: "system:scheduler" });
      expect(audit({ subjectType: "recurring_template", subjectId: "template-1", action: "update" }))
        .toMatchObject({ actorId: "system:scheduler" });
      return {
        materialized: [{ templateId: "template-1", eventIds: ["event-1", "event-2"], createdEventIds: ["event-1", "event-2"] }],
        inspected: 1,
        hasMore: false,
        nextTemplateCursor: null,
      };
    });
    const job = new ScheduledRecurrenceMaterializationJob(
      { materializeDueBatch },
      { publish },
    );
    await expect(job.run({
      now: NOW,
      afterTemplateId: "template-000",
      maxTemplates: 2,
      maxOccurrencesPerTemplate: 10,
      audit: createSchedulerAuditFactory("recurrence", NOW),
    })).resolves.toEqual({ processed: 2, hasMore: false, nextTemplateCursor: null });
    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "entity_changed",
        entity_id: "event-1",
        hint: "event_created",
      }),
      { type: "inbox_changed" },
    ]);
    await expect(job.inspectBacklog({ now: NOW })).resolves.toMatchObject({
      status: "unknown",
      reason: "unsupported",
    });
  });

  it("publishes only the IDs actually archived by the bounded store", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const archiveDue = vi.fn().mockResolvedValue({ eventIds: ["event-1", "event-2"], hasMore: true });
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledEventAutoArchiveJob({ archiveDue, inspectBacklog }, { publish });
    await expect(job.run({
      now: NOW,
      limit: 50,
      audit: createSchedulerAuditFactory("archive", NOW),
    })).resolves.toEqual({ processed: 2, hasMore: true });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: "event-1",
      hint: "event_archived",
    }));
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(job.inspectBacklog({ now: NOW })).resolves.toEqual(backlog);
  });

  it("publishes only announcements atomically claimed by the scheduled store", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publishDue = vi.fn(async (input: Parameters<BoundedAnnouncementPublishStore["publishDue"]>[0]) => {
      expect(input.audit({
        subjectType: "announcement",
        subjectId: "announcement-1",
        action: "publish",
      })).toMatchObject({ actorId: "system:scheduler" });
      return {
        announcements: [
          { id: "announcement-1", title: "Notice", publishedAt: NOW },
          { id: "announcement-2", title: "Notice 2", publishedAt: NOW },
        ],
        hasMore: false,
      };
    });
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledAnnouncementPublishJob({ publishDue, inspectBacklog }, { publish });

    await expect(job.run({
      now: NOW,
      limit: 50,
      audit: createSchedulerAuditFactory("announcement", NOW),
    })).resolves.toEqual({ processed: 2, hasMore: false });
    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "entity_changed",
        entity_type: "announcement",
        entity_id: "announcement-1",
        updated_at: NOW,
        hint: "announcement_published",
      },
      { type: "inbox_changed" },
    ]);
    await expect(job.inspectBacklog({ now: NOW })).resolves.toEqual(backlog);
  });

  it("draws due raffles with the shared selection rule and ignores a lost unique claim", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const listDue = vi.fn().mockResolvedValue({
      raffles: [{
        eventId: "raffle-1",
        title: "Draw",
        winnerCount: 2,
        drawnByUserId: "owner-1",
        updatedAt: "2026-08-08T23:59:59.999Z",
        participantIds: ["user-1", "user-2", "user-3"],
      }],
      hasMore: false,
    });
    const drawRaffle = vi.fn().mockResolvedValue(undefined);
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    let rowId = 0;
    const job = new ScheduledRaffleAutoDrawJob(
      { listDue, drawRaffle, inspectBacklog },
      { publish },
      { random: () => 0, createId: () => `winner-${rowId += 1}` },
    );

    await expect(job.run({
      now: NOW,
      limit: SCHEDULED_JOB_LIMITS.raffleAutoDraw,
      audit: createSchedulerAuditFactory("raffle", NOW),
    })).resolves.toEqual({ processed: 1, hasMore: false });
    expect(drawRaffle).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "raffle-1",
      winnerIds: ["user-1", "user-2"],
      drawnByUserId: "owner-1",
      expectedUpdatedAt: "2026-08-08T23:59:59.999Z",
      updatedAt: NOW,
      audit: expect.objectContaining({ actorId: "system:scheduler", action: "raffle_draw" }),
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ hint: "raffle_drawn" }));

    drawRaffle.mockRejectedValueOnce(new AppError({
      code: "CONFLICT",
      status: 409,
      message: "Raffle winners already drawn",
    }));
    await expect(job.run({
      now: NOW,
      limit: SCHEDULED_JOB_LIMITS.raffleAutoDraw,
      audit: createSchedulerAuditFactory("raffle-lost", NOW),
    })).resolves.toEqual({ processed: 0, hasMore: false });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("runs media GC anonymously and delegates the fixed audit archive batch", async () => {
    const collectGarbage = vi.fn(async (
      context: RequestContext,
      _before: string,
      audit: (mediaId: string) => unknown,
    ) => {
      expect(context.authorization.actor).toBeNull();
      expect(audit("media-1")).toMatchObject({
        actorId: "system:scheduler",
        subjectType: "media_cleanup",
        payload: {
          context: [{ field: "reason", value: { type: "code", value: "garbage_collection" } }],
        },
      });
      return { deleted: 2 };
    });
    const inspectGarbageBacklog = vi.fn().mockResolvedValue(backlog);
    const media = new ScheduledMediaGarbageCollectionJob({ collectGarbage, inspectGarbageBacklog } as never);
    await expect(media.run({
      before: NOW,
      limit: MEDIA_GARBAGE_COLLECTION_BATCH_SIZE,
      audit: createSchedulerAuditFactory("media", NOW),
    })).resolves.toEqual({ processed: 2, hasMore: false });
    await expect(media.inspectBacklog({ before: NOW })).resolves.toEqual(backlog);

    const archiveBatch = vi.fn(async (
      _before: string,
      _now: string,
      audit: (archiveId: string, rowCount: number) => unknown,
    ) => {
      expect(audit("archive-1", 100)).toMatchObject({
        actorId: "system:scheduler",
        subjectType: "audit_archive_export",
      });
      return { archived: 100, archiveId: "archive-1" };
    });
    const cleanupExpired = vi.fn().mockResolvedValue({ deleted: 0 });
    const inspectCombinedBacklog = vi.fn().mockResolvedValue(backlog);
    const audit = new ScheduledAuditArchiveJob({ archiveBatch, cleanupExpired, inspectCombinedBacklog });
    await expect(audit.run({
      before: "2026-05-01T00:00:00.000Z",
      expiredBefore: "2025-08-09T12:00:00.000Z",
      now: NOW,
      limit: 100,
      audit: createSchedulerAuditFactory("audit", NOW),
    }))
      .resolves.toEqual({ processed: 100, hasMore: true });
    expect(cleanupExpired).toHaveBeenCalledWith(
      "2025-08-09T12:00:00.000Z",
      16,
      expect.any(Function),
    );
    await expect(audit.inspectBacklog({
      before: "2026-05-01T00:00:00.000Z",
      expiredBefore: "2025-08-09T12:00:00.000Z",
    })).resolves.toEqual(backlog);
  });

  it.each(["recurrence", "archive", "announcement", "raffle"] as const)(
    "preserves all committed %s records and reports failed batched refreshes",
    async (kind) => {
      const publish = vi.fn().mockRejectedValue(new Error("push unavailable"));
      const audit = createSchedulerAuditFactory(kind, NOW);
      let result;
      if (kind === "recurrence") {
        const job = new ScheduledRecurrenceMaterializationJob({
          materializeDueBatch: vi.fn().mockResolvedValue({
            materialized: [{ templateId: "template-1", eventIds: ["event-1", "event-2"], createdEventIds: ["event-1", "event-2"] }],
            inspected: 1, hasMore: false, nextTemplateCursor: null,
          }),
        }, { publish });
        result = await job.run({ now: NOW, afterTemplateId: null, maxTemplates: 2, maxOccurrencesPerTemplate: 10, audit });
      } else if (kind === "archive") {
        result = await new ScheduledEventAutoArchiveJob({
          archiveDue: vi.fn().mockResolvedValue({ eventIds: ["event-1", "event-2"], hasMore: false }),
          inspectBacklog: vi.fn(),
        }, { publish }).run({ now: NOW, limit: 50, audit });
      } else if (kind === "announcement") {
        result = await new ScheduledAnnouncementPublishJob({
          publishDue: vi.fn().mockResolvedValue({
            announcements: ["announcement-1", "announcement-2"].map((id) => ({ id, title: id, publishedAt: NOW })),
            hasMore: false,
          }),
          inspectBacklog: vi.fn(),
        }, { publish }).run({ now: NOW, limit: 50, audit });
      } else {
        const drawRaffle = vi.fn().mockResolvedValue(undefined);
        result = await new ScheduledRaffleAutoDrawJob({
          listDue: vi.fn().mockResolvedValue({
            raffles: ["raffle-1", "raffle-2"].map((eventId) => ({
              eventId, title: eventId, winnerCount: 1, drawnByUserId: "owner", updatedAt: NOW, participantIds: ["member"],
            })),
            hasMore: false,
          }),
          drawRaffle,
          inspectBacklog: vi.fn(),
        }, { publish }).run({ now: NOW, limit: 2, audit });
        expect(drawRaffle).toHaveBeenCalledTimes(2);
      }
      expect(result).toMatchObject({
        processed: 2, hasMore: false,
        warning: expect.stringContaining("Database changes committed; live refresh failed: entity_changed: push unavailable"),
      });
      expect(publish).toHaveBeenCalledTimes(kind === "recurrence" || kind === "announcement" ? 2 : 1);
      if (kind === "recurrence" || kind === "announcement") {
        expect(result.warning).toContain("inbox_changed: push unavailable");
      }
    },
  );

  it("invalidates committed raffle results even if a later database draw fails", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const drawRaffle = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("database unavailable"));
    const job = new ScheduledRaffleAutoDrawJob({
      listDue: vi.fn().mockResolvedValue({
        raffles: ["raffle-1", "raffle-2"].map((eventId) => ({
          eventId, title: eventId, winnerCount: 1, drawnByUserId: "owner", updatedAt: NOW, participantIds: ["member"],
        })),
        hasMore: false,
      }),
      drawRaffle,
      inspectBacklog: vi.fn(),
    }, { publish });
    await expect(job.run({ now: NOW, limit: 2, audit: createSchedulerAuditFactory("partial-raffle", NOW) }))
      .rejects.toThrow("Raffle batch committed 1 draw(s) before failing: database unavailable");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ entity_id: "raffle-1" }));
  });

  it("propagates media garbage-collection failures instead of reporting completed work", async () => {
    const failure = new AggregateError([new Error("R2 delete failed")], "Media garbage collection failed");
    const collectGarbage = vi.fn().mockRejectedValue(failure);
    const inspectGarbageBacklog = vi.fn().mockResolvedValue(backlog);
    const media = new ScheduledMediaGarbageCollectionJob({ collectGarbage, inspectGarbageBacklog } as never);

    await expect(media.run({
      before: NOW,
      limit: MEDIA_GARBAGE_COLLECTION_BATCH_SIZE,
      audit: createSchedulerAuditFactory("media-failure", NOW),
    })).rejects.toBe(failure);
  });

  it("cleans one expired system-test run per scheduled batch", async () => {
    const cleanupExpired = vi.fn().mockResolvedValue({ processed: 1, completed: 1, failed: 0 });
    const inspectExpiredBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledSystemTestCleanupJob({ cleanupExpired, inspectExpiredBacklog });
    await expect(job.run({ before: NOW, limit: 1 }))
      .resolves.toEqual({ processed: 1, hasMore: true });
    expect(cleanupExpired).toHaveBeenCalledWith(NOW, 1);
    await expect(job.inspectBacklog({ before: NOW })).resolves.toEqual(backlog);
    await expect(job.run({ before: NOW, limit: 2 })).rejects.toThrow("one run per batch");
  });
});
