import { describe, expect, it, vi } from "vitest";
import { AppError, type RequestContext } from "@guild/kernel";
import { createSchedulerAuditFactory } from "./scheduled-jobs.js";
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
      audit: (eventId: string, title: string, templateId: string) => unknown,
    ) => {
      expect(afterTemplateId).toBe("template-000");
      expect(audit("event-1", "Event", "template-1")).toMatchObject({ actorUserId: "system:scheduler" });
      return {
        materialized: [{ templateId: "template-1", eventIds: ["event-1"], createdEventIds: ["event-1"] }],
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
      maxTemplates: 25,
      maxOccurrencesPerTemplate: 10,
      audit: createSchedulerAuditFactory("recurrence", NOW),
    })).resolves.toEqual({ processed: 1, hasMore: false, nextTemplateCursor: null });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: "event-1",
      hint: "event_created",
    }));
    await expect(job.inspectBacklog({ now: NOW })).resolves.toMatchObject({
      status: "unknown",
      reason: "unsupported",
    });
  });

  it("publishes only the IDs actually archived by the bounded store", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const archiveDue = vi.fn().mockResolvedValue({ eventIds: ["event-1"], hasMore: true });
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledEventAutoArchiveJob({ archiveDue, inspectBacklog }, { publish });
    await expect(job.run({
      now: NOW,
      limit: 50,
      audit: createSchedulerAuditFactory("archive", NOW),
    })).resolves.toEqual({ processed: 1, hasMore: true });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: "event-1",
      hint: "event_archived",
    }));
    await expect(job.inspectBacklog({ now: NOW })).resolves.toEqual(backlog);
  });

  it("publishes only announcements atomically claimed by the scheduled store", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publishDue = vi.fn(async (input: Parameters<BoundedAnnouncementPublishStore["publishDue"]>[0]) => {
      expect(input.audit({
        entityType: "announcement",
        entityId: "announcement-1",
        action: "publish",
      })).toMatchObject({ actorUserId: "system:scheduler" });
      return {
        announcements: [{ id: "announcement-1", title: "Notice", publishedAt: NOW }],
        hasMore: false,
      };
    });
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledAnnouncementPublishJob({ publishDue, inspectBacklog }, { publish });

    await expect(job.run({
      now: NOW,
      limit: 50,
      audit: createSchedulerAuditFactory("announcement", NOW),
    })).resolves.toEqual({ processed: 1, hasMore: false });
    expect(publish).toHaveBeenCalledWith({
      type: "announcement_published",
      announcement_id: "announcement-1",
      title: "Notice",
      published_at: NOW,
    });
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
      limit: 25,
      audit: createSchedulerAuditFactory("raffle", NOW),
    })).resolves.toEqual({ processed: 1, hasMore: false });
    expect(drawRaffle).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "raffle-1",
      winnerIds: ["user-1", "user-2"],
      drawnByUserId: "owner-1",
      audit: expect.objectContaining({ actorUserId: "system:scheduler", action: "raffle_draw" }),
    }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ hint: "raffle_drawn" }));

    drawRaffle.mockRejectedValueOnce(new AppError({
      code: "CONFLICT",
      status: 409,
      message: "Raffle winners already drawn",
    }));
    await expect(job.run({
      now: NOW,
      limit: 25,
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
        actorUserId: "system:scheduler",
        entityType: "media_cleanup",
      });
      return { deleted: 2, failed: 1 };
    });
    const inspectGarbageBacklog = vi.fn().mockResolvedValue(backlog);
    const media = new ScheduledMediaGarbageCollectionJob({ collectGarbage, inspectGarbageBacklog } as never);
    await expect(media.run({
      before: NOW,
      limit: 50,
      audit: createSchedulerAuditFactory("media", NOW),
    })).resolves.toEqual({ processed: 3, hasMore: false });
    await expect(media.inspectBacklog({ before: NOW })).resolves.toEqual(backlog);

    const archiveBatch = vi.fn(async (
      _before: string,
      _now: string,
      audit: (archiveId: string, rowCount: number) => unknown,
    ) => {
      expect(audit("archive-1", 100)).toMatchObject({
        actorUserId: "system:scheduler",
        entityType: "audit_archive_export",
      });
      return { archived: 100, archiveId: "archive-1" };
    });
    const inspectBacklog = vi.fn().mockResolvedValue(backlog);
    const audit = new ScheduledAuditArchiveJob({ archiveBatch, inspectBacklog });
    await expect(audit.run({
      before: "2026-05-01T00:00:00.000Z",
      now: NOW,
      limit: 100,
      audit: createSchedulerAuditFactory("audit", NOW),
    }))
      .resolves.toEqual({ processed: 100, hasMore: true });
    await expect(audit.inspectBacklog({ before: "2026-05-01T00:00:00.000Z" })).resolves.toEqual(backlog);
  });

  it("cleans expired system-test runs in fixed batches of 25", async () => {
    const cleanupExpired = vi.fn().mockResolvedValue({ processed: 25, completed: 24, failed: 1 });
    const inspectExpiredBacklog = vi.fn().mockResolvedValue(backlog);
    const job = new ScheduledSystemTestCleanupJob({ cleanupExpired, inspectExpiredBacklog });
    await expect(job.run({ before: NOW, limit: 25 }))
      .resolves.toEqual({ processed: 25, hasMore: true });
    expect(cleanupExpired).toHaveBeenCalledWith(NOW, 25);
    await expect(job.inspectBacklog({ before: NOW })).resolves.toEqual(backlog);
    await expect(job.run({ before: NOW, limit: 26 })).rejects.toThrow("batches of 25");
  });
});
