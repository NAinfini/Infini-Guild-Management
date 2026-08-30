import {
  AppError,
  createAuthorizationContext,
  createRequestContext,
  secureRandom,
  type NotificationPublisher,
  type ScheduledJobBacklog,
} from "@guild/kernel";
import { nanoid } from "nanoid";
import {
  AUDIT_ARCHIVE_BATCH_SIZE,
  AUDIT_ARCHIVE_CLEANUP_BATCH_SIZE,
  type AuditArchiveService,
} from "../audit/public.js";
import type {
  MaterializationAuditFactory,
  RecurrenceMaterialization,
} from "../events/public.js";
import { monotonicTimestamp, selectRaffleWinnerIds } from "../events/public.js";
import {
  MEDIA_GARBAGE_COLLECTION_BATCH_SIZE,
  type MediaService,
} from "../media/public.js";
import type { SystemTestService } from "../system-test/public.js";
import type {
  AuditArchiveJob,
  AnnouncementPublishJob,
  EventAutoArchiveJob,
  MediaGarbageCollectionJob,
  RecurrenceMaterializationJob,
  RaffleAutoDrawJob,
  SchedulerAuditFactory,
  SystemTestCleanupJob,
} from "./scheduled-jobs.js";

export interface BoundedRecurrenceMaterializationStore {
  materializeDueBatch(
    now: string,
    afterTemplateId: string | null,
    maxTemplates: number,
    maxOccurrencesPerTemplate: number,
    createAudit: MaterializationAuditFactory,
  ): Promise<Readonly<{
    materialized: readonly RecurrenceMaterialization[];
    inspected: number;
    hasMore: boolean;
    nextTemplateCursor: string | null;
  }>>;
}

export interface BoundedEventAutoArchiveStore {
  archiveDue(input: Readonly<{
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<Readonly<{ eventIds: readonly string[]; hasMore: boolean }>>;
  inspectBacklog(now: string): Promise<ScheduledJobBacklog>;
}

export type ScheduledAnnouncementPublication = Readonly<{
  id: string;
  title: string;
  publishedAt: string;
}>;

export interface BoundedAnnouncementPublishStore {
  publishDue(input: Readonly<{
    now: string;
    limit: number;
    audit: SchedulerAuditFactory;
  }>): Promise<Readonly<{
    announcements: readonly ScheduledAnnouncementPublication[];
    hasMore: boolean;
  }>>;
  inspectBacklog(now: string): Promise<ScheduledJobBacklog>;
}

export type DueRaffle = Readonly<{
  eventId: string;
  title: string;
  winnerCount: number;
  drawnByUserId: string;
  updatedAt: string;
  participantIds: readonly string[];
}>;

export interface BoundedRaffleAutoDrawStore {
  listDue(now: string, limit: number): Promise<Readonly<{
    raffles: readonly DueRaffle[];
    hasMore: boolean;
  }>>;
  drawRaffle(input: Readonly<{
    eventId: string;
    winnerIds: readonly string[];
    winnerRowIds: readonly string[];
    now: string;
    drawnByUserId: string;
    expectedUpdatedAt: string;
    updatedAt: string;
    audit: ReturnType<SchedulerAuditFactory>;
  }>): Promise<void>;
  inspectBacklog(now: string): Promise<ScheduledJobBacklog>;
}

export class ScheduledRecurrenceMaterializationJob implements RecurrenceMaterializationJob {
  constructor(
    private readonly store: BoundedRecurrenceMaterializationStore,
    private readonly notifications: NotificationPublisher,
  ) {}

  async run(input: Parameters<RecurrenceMaterializationJob["run"]>[0]) {
    const batch = await this.store.materializeDueBatch(
      input.now,
      input.afterTemplateId,
      input.maxTemplates,
      input.maxOccurrencesPerTemplate,
      input.audit,
    );
    const eventIds = batch.materialized.flatMap(({ createdEventIds }) => createdEventIds);
    for (const eventId of eventIds) {
      await this.notifications.publish({
        type: "entity_changed",
        entity_type: "event",
        entity_id: eventId,
        updated_at: input.now,
        hint: "event_created",
      });
    }
    if (eventIds.length > 0) {
      await this.notifications.publish({ type: "inbox_changed" });
    }
    return {
      processed: eventIds.length,
      hasMore: batch.hasMore
        || batch.materialized.some(({ createdEventIds }) => (
          createdEventIds.length === input.maxOccurrencesPerTemplate
        )),
      nextTemplateCursor: batch.nextTemplateCursor,
    };
  }

  async inspectBacklog(
    _input: Parameters<RecurrenceMaterializationJob["inspectBacklog"]>[0],
  ): Promise<ScheduledJobBacklog> {
    return {
      status: "unknown",
      pendingCount: null,
      countPrecision: "unknown",
      oldestPendingAt: null,
      reason: "unsupported",
      detail: "Recurrence due times are computed from template rules rather than stored as a queue",
    };
  }
}

export class ScheduledEventAutoArchiveJob implements EventAutoArchiveJob {
  constructor(
    private readonly store: BoundedEventAutoArchiveStore,
    private readonly notifications: NotificationPublisher,
  ) {}

  async run(input: Parameters<EventAutoArchiveJob["run"]>[0]) {
    const batch = await this.store.archiveDue(input);
    for (const eventId of batch.eventIds) {
      await this.notifications.publish({
        type: "entity_changed",
        entity_type: "event",
        entity_id: eventId,
        updated_at: input.now,
        hint: "event_archived",
      });
    }
    return { processed: batch.eventIds.length, hasMore: batch.hasMore };
  }

  inspectBacklog(input: Parameters<EventAutoArchiveJob["inspectBacklog"]>[0]) {
    return this.store.inspectBacklog(input.now);
  }
}

export class ScheduledAnnouncementPublishJob implements AnnouncementPublishJob {
  constructor(
    private readonly store: BoundedAnnouncementPublishStore,
    private readonly notifications: NotificationPublisher,
  ) {}

  async run(input: Parameters<AnnouncementPublishJob["run"]>[0]) {
    const batch = await this.store.publishDue(input);
    for (const announcement of batch.announcements) {
      await this.notifications.publish({
        type: "entity_changed",
        entity_type: "announcement",
        entity_id: announcement.id,
        updated_at: announcement.publishedAt,
        hint: "announcement_published",
      });
    }
    if (batch.announcements.length > 0) {
      await this.notifications.publish({ type: "inbox_changed" });
    }
    return { processed: batch.announcements.length, hasMore: batch.hasMore };
  }

  inspectBacklog(input: Parameters<AnnouncementPublishJob["inspectBacklog"]>[0]) {
    return this.store.inspectBacklog(input.now);
  }
}

export class ScheduledRaffleAutoDrawJob implements RaffleAutoDrawJob {
  private readonly random: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly store: BoundedRaffleAutoDrawStore,
    private readonly notifications: NotificationPublisher,
    options: Readonly<{ random?: () => number; createId?: () => string }> = {},
  ) {
    this.random = options.random ?? secureRandom;
    this.createId = options.createId ?? nanoid;
  }

  async run(input: Parameters<RaffleAutoDrawJob["run"]>[0]) {
    const batch = await this.store.listDue(input.now, input.limit);
    let processed = 0;
    for (const raffle of batch.raffles) {
      const winnerIds = selectRaffleWinnerIds(
        raffle.participantIds,
        raffle.winnerCount,
        this.random,
      );
      if (winnerIds.length === 0) continue;
      const updatedAt = monotonicTimestamp(input.now, raffle.updatedAt);
      try {
        await this.store.drawRaffle({
          eventId: raffle.eventId,
          winnerIds,
          winnerRowIds: winnerIds.map(() => this.createId()),
          now: input.now,
          drawnByUserId: raffle.drawnByUserId,
          expectedUpdatedAt: raffle.updatedAt,
          updatedAt,
          audit: input.audit({
            subjectType: "event",
            subjectId: raffle.eventId,
            subjectLabel: raffle.title,
            action: "raffle_draw",
            context: [],
          }),
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "CONFLICT") continue;
        throw error;
      }
      processed += 1;
      await this.notifications.publish({
        type: "entity_changed",
        entity_type: "event",
        entity_id: raffle.eventId,
        updated_at: updatedAt,
        hint: "raffle_drawn",
      });
    }
    return { processed, hasMore: batch.hasMore };
  }

  inspectBacklog(input: Parameters<RaffleAutoDrawJob["inspectBacklog"]>[0]) {
    return this.store.inspectBacklog(input.now);
  }
}

export class ScheduledMediaGarbageCollectionJob implements MediaGarbageCollectionJob {
  constructor(private readonly media: Pick<MediaService, "collectGarbage" | "inspectGarbageBacklog">) {}

  async run(input: Parameters<MediaGarbageCollectionJob["run"]>[0]) {
    if (input.limit !== MEDIA_GARBAGE_COLLECTION_BATCH_SIZE) {
      throw new RangeError(`Media garbage collection uses batches of ${MEDIA_GARBAGE_COLLECTION_BATCH_SIZE}`);
    }
    const context = createRequestContext({
      requestId: `scheduled:media-gc:${input.before}`,
      authorization: createAuthorizationContext(null),
      now: input.before,
    });
    const result = await this.media.collectGarbage(context, input.before, (mediaId) => input.audit({
      subjectType: "media_cleanup",
      subjectId: mediaId,
      subjectLabel: null,
      action: "delete",
      context: [{ field: "reason", value: { type: "code", value: "garbage_collection" } }],
    }));
    const processed = result.deleted;
    return { processed, hasMore: processed === input.limit };
  }

  inspectBacklog(input: Parameters<MediaGarbageCollectionJob["inspectBacklog"]>[0]) {
    return this.media.inspectGarbageBacklog(input.before);
  }
}

export class ScheduledAuditArchiveJob implements AuditArchiveJob {
  constructor(private readonly archives: Pick<
    AuditArchiveService,
    "archiveBatch" | "cleanupExpired" | "inspectCombinedBacklog"
  >) {}

  async run(input: Parameters<AuditArchiveJob["run"]>[0]) {
    if (input.limit !== AUDIT_ARCHIVE_BATCH_SIZE) {
      throw new RangeError(`Audit archive batches must contain ${AUDIT_ARCHIVE_BATCH_SIZE} rows`);
    }
    const cleanup = await this.archives.cleanupExpired(
      input.expiredBefore,
      AUDIT_ARCHIVE_CLEANUP_BATCH_SIZE,
      (archiveId, rowCount) => input.audit({
        subjectType: "audit_archive_export",
        subjectId: archiveId,
        subjectLabel: null,
        action: "delete",
        context: [
          { field: "reason", value: { type: "code", value: "retention_expired" } },
          { field: "row_count", value: { type: "number", value: rowCount } },
        ],
      }),
    );
    if (cleanup.deleted > 0) return { processed: cleanup.deleted, hasMore: true };

    const result = await this.archives.archiveBatch(input.before, input.now, (archiveId, rowCount) => input.audit({
      subjectType: "audit_archive_export",
      subjectId: archiveId,
      subjectLabel: null,
      action: "archive",
      context: [{ field: "row_count", value: { type: "number", value: rowCount } }],
    }));
    return { processed: result.archived, hasMore: result.archived === input.limit };
  }

  inspectBacklog(input: Parameters<AuditArchiveJob["inspectBacklog"]>[0]) {
    return this.archives.inspectCombinedBacklog(input.before, input.expiredBefore);
  }
}

export class ScheduledSystemTestCleanupJob implements SystemTestCleanupJob {
  constructor(private readonly systemTests: Pick<SystemTestService, "cleanupExpired" | "inspectExpiredBacklog">) {}

  async run(input: Parameters<SystemTestCleanupJob["run"]>[0]) {
    if (input.limit !== 1) throw new RangeError("System-test cleanup uses one run per batch");
    const result = await this.systemTests.cleanupExpired(input.before, input.limit);
    return { processed: result.processed, hasMore: result.processed === input.limit };
  }

  inspectBacklog(input: Parameters<SystemTestCleanupJob["inspectBacklog"]>[0]) {
    return this.systemTests.inspectExpiredBacklog(input.before);
  }
}
