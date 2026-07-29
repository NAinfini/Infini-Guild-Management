import {
  DEFAULT_SITE_MEDIA_POLICY,
  createEventSchema,
  eventSchema,
  updateEventSchema,
  LIMITS,
  type SiteMediaPolicy,
} from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "../audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  eventParticipants,
  eventRaffleWinners,
  events,
} from "../../db/schema";
import { escapeLikePattern, likeEscaped } from "../helpers";
import { err, ok, type ServiceErr, type ServiceResult } from "../result";
import { toParticipantPayload, type EventParticipantRow } from "./EventParticipantService";
import {
  EventPollRaffleService,
  toRaffleWinnerPayload,
  type RaffleWinnerRow,
} from "./EventPollRaffleService";
import { eventPublicVisibilityFilter, isEventPubliclyVisible } from "./event-visibility";
import { buildReplaceMediaRefsStatements, replaceMediaRefs, deleteMediaRefs, extractAttachmentKeys } from "../media-references";
import { rethrowAfterUploadFailure } from "../media-upload-compensation";

export { toParticipantPayload, type EventParticipantRow } from "./EventParticipantService";
export { toRaffleWinnerPayload, type RaffleWinnerRow } from "./EventPollRaffleService";

export type DatabaseLike = DrizzleD1Database;

type BoundStatement = {
  run: () => Promise<{ meta?: { changes?: number } }>;
  all?: () => Promise<{ results?: unknown[] } | unknown[]>;
};

export type RawDbLike = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => BoundStatement;
  };
  batch: (statements: BoundStatement[]) => Promise<unknown[]>;
};

export type MediaLike = {
  put: (key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => Promise<unknown> | unknown;
  delete: (key: string) => Promise<unknown> | unknown;
};

export type EventRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  capacity: number | null;
  pinned: boolean;
  signupLocked: boolean;
  visibleAt: string | null;
  archivedAt: string | null;
  autoArchive: boolean;
  autoArchived: boolean;
  createdBy: string;
  updatedBy: string | null;
  attachments: string;
  seriesId: string | null;
  instanceDate: string | null;
  winnerCount: number | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_EVENT_ATTACHMENTS = LIMITS.content.eventAttachments.max;
export type EventServiceDeps = {
  getEventById: (eventId: string) => Promise<EventRow | null>;
  getUsername: (userId: string) => Promise<string | null>;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (payload: { entityType: PushEntityType; entityId: string; hint: PushHint; displayName?: string }) => Promise<void>;
  now?: () => string;
  createId?: () => string;
  createImageKey?: (eventId: string) => string;
  getMediaPolicy?: () => Promise<SiteMediaPolicy>;
};

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export function parseRecurrenceRule(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

type RecurrenceRuleObj = {
  frequency?: string;
  interval?: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endAfter?: number;
  endDate?: string;
};

export function diffRecurrenceRule(
  existingJson: string | null,
  newRule: unknown,
  diff: Record<string, { from: unknown; to: unknown }>,
): void {
  const old: RecurrenceRuleObj = existingJson ? (JSON.parse(existingJson) as RecurrenceRuleObj) : {};
  const nw = (newRule ?? {}) as RecurrenceRuleObj;
  const FIELDS: (keyof RecurrenceRuleObj)[] = ["frequency", "interval", "daysOfWeek", "dayOfMonth", "endAfter", "endDate"];
  for (const f of FIELDS) {
    const o = old[f] ?? null;
    const n = nw[f] ?? null;
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      diff[`recurrence_rule.${f}`] = { from: o, to: n };
    }
  }
}

export function parseAttachments(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_EVENT_ATTACHMENTS);
  } catch {
    return [];
  }
}

export function toEventPayload(row: EventRow) {
  const result = eventSchema.safeParse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    capacity: row.capacity,
    pinned: row.pinned,
    signup_locked: row.signupLocked,
    auto_archive: row.autoArchive,
    auto_archived: row.autoArchived,
    visible_at: row.visibleAt,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    updated_by: row.updatedBy ?? null,
    attachments: parseAttachments(row.attachments),
    series_id: row.seriesId,
    instance_date: row.instanceDate,
    winner_count: row.winnerCount ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid event data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export class EventCrudService {
  private readonly db: DatabaseLike;
  private readonly rawDb: RawDbLike;
  private readonly media: MediaLike;
  private readonly deps: EventServiceDeps;
  private readonly pollRaffle: EventPollRaffleService;

  constructor(db: DatabaseLike, rawDb: RawDbLike, media: MediaLike, deps: EventServiceDeps) {
    this.db = db;
    this.rawDb = rawDb;
    this.media = media;
    this.deps = deps;
    this.pollRaffle = new EventPollRaffleService(db, rawDb, deps);
  }

  async createEvent(actorId: string, data: CreateEventInput, files: File[] = []): Promise<ServiceResult<EventRow>> {
    const dateErr = this.validateDateRange(data.start_at, data.end_at);
    if (dateErr) return dateErr;
    const pollErr = this.pollRaffle.validatePollEventInput(data);
    if (pollErr) return pollErr;
    const raffleErr = this.pollRaffle.validateRaffleEventInput(data);
    if (raffleErr) return raffleErr;
    if ((data.attachments?.length ?? 0) + files.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const eventId = this.deps.createId?.() ?? nanoid();
    const imageResult = await this.storeImages(eventId, files, 0);
    if ("ok" in imageResult && !imageResult.ok) return imageResult;
    const uploadedAttachments = imageResult as string[];
    const attachments = [...(data.attachments ?? []), ...uploadedAttachments];

    const now = this.now();
    try {
      await this.db.insert(events).values({
        id: eventId,
        type: data.type,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        startAt: data.start_at,
        endAt: data.end_at ?? null,
        capacity: data.type === "poll" ? null : data.capacity ?? null,
        winnerCount: data.type === "raffle" ? data.winner_count ?? null : null,
        pinned: false,
        signupLocked: false,
        autoArchive: data.auto_archive ?? false,
        autoArchived: false,
        archivedAt: null,
        createdBy: actorId,
        attachments: JSON.stringify(attachments),
        seriesId: null,
        instanceDate: null,
        createdAt: now,
        updatedAt: now,
      });

      if (data.type === "poll" && data.poll) {
        await this.pollRaffle.createPoll(eventId, data.poll);
      }

      const created = await this.deps.getEventById(eventId);
      if (!created) {
        throw new Error("Failed to load created event");
      }

      await replaceMediaRefs(this.rawDb as unknown as D1Database, "event", eventId, extractAttachmentKeys(created.attachments));

      await this.deps.writeAuditLog({
        entityType: "event",
        action: "create",
        actorId,
        entityId: eventId,
        diffTitle: created.title,
        detailText: JSON.stringify({
          type: created.type,
          start_at: created.startAt,
          end_at: created.endAt,
        }),
      });

      await this.deps.publishEntityChanged({
        entityType: "event",
        entityId: eventId,
        hint: "event_created",
        displayName: created.title,
      });

      return ok(created);
    } catch (error) {
      return rethrowAfterUploadFailure(
        error,
        (key) => Promise.resolve(this.media.delete(key)),
        uploadedAttachments,
        async () => {
          await this.rawDb.batch([
            this.rawDb.prepare("UPDATE war_history SET event_id = NULL, updated_at = ?1 WHERE event_id = ?2").bind(now, eventId),
            this.rawDb.prepare("DELETE FROM event_raffle_winners WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM event_polls WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM event_participants WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id IN (SELECT id FROM war_teams WHERE event_id = ?1)").bind(eventId),
            this.rawDb.prepare("DELETE FROM war_teams WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM war_pool_members WHERE event_id = ?1").bind(eventId),
            this.rawDb.prepare("DELETE FROM media_references WHERE entity_type = ?1 AND entity_id = ?2").bind("event", eventId),
            this.rawDb.prepare("DELETE FROM audit_log WHERE entity_type = ?1 AND entity_id = ?2").bind("event", eventId),
            this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(eventId),
          ]);
        },
      );
    }
  }

  async updateEvent(actorId: string, eventId: string, existing: EventRow, data: UpdateEventInput): Promise<ServiceResult<EventRow>> {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    const dateErr = this.validateDateRange(effectiveStartAt, effectiveEndAt);
    if (dateErr) return dateErr;
    const pollUpdateErr = this.pollRaffle.validatePollEventUpdate(existing, data, effectiveEndAt);
    if (pollUpdateErr) return pollUpdateErr;

    const patch: Record<string, unknown> = {
      updatedAt: this.now(),
      updatedBy: actorId,
    };

    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.description !== undefined) patch.description = data.description?.trim() || null;
    if (data.start_at !== undefined) patch.startAt = data.start_at;
    if (data.end_at !== undefined) patch.endAt = data.end_at ?? null;
    if (data.capacity !== undefined) patch.capacity = existing.type === "poll" || data.type === "poll" ? null : data.capacity ?? null;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.signup_locked !== undefined) patch.signupLocked = data.signup_locked;
    if (data.auto_archive !== undefined) patch.autoArchive = data.auto_archive;
    if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;
    if (data.attachments !== undefined) patch.attachments = JSON.stringify(data.attachments);

    const pollDataProvided = (existing.type === "poll" || data.type === "poll") && data.poll;
    const hasVotes = pollDataProvided ? await this.pollRaffle.pollHasVotes(eventId) : false;

    if (pollDataProvided && hasVotes && await this.pollRaffle.pollOptionsChanged(eventId, data.poll!.options)) {
      return err("VALIDATION_ERROR", "Poll options cannot be changed after voting starts");
    }

    await this.db.update(events).set(patch).where(eq(events.id, eventId));

    if (pollDataProvided) {
      const pollErr = await this.pollRaffle.updatePoll(eventId, data.poll!, hasVotes);
      if (pollErr) return pollErr;
    }

    const updated = await this.deps.getEventById(eventId);
    if (!updated) {
      throw new Error("Failed to load updated event");
    }

    await replaceMediaRefs(this.rawDb as unknown as D1Database, "event", eventId, extractAttachmentKeys(updated.attachments));

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "update",
      actorId,
      entityId: eventId,
      diffTitle: updated.title,
      detailText: JSON.stringify(this.buildUpdateDiff(existing, data)),
    });

    return ok(updated);
  }

  async archiveEvent(actorId: string, eventId: string, existing: EventRow) {
    const now = this.now();
    await this.db
      .update(events)
      .set({
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, eventId));

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "archive",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
    });
  }

  async destroyEvent(actorId: string, eventId: string, existing: EventRow) {
    const now = this.now();
    await this.rawDb.batch([
      this.rawDb.prepare("UPDATE war_history SET event_id = NULL, updated_at = ?1 WHERE event_id = ?2").bind(now, eventId),
      this.rawDb.prepare("DELETE FROM event_raffle_winners WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_polls WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_participants WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_team_members WHERE war_team_id IN (SELECT id FROM war_teams WHERE event_id = ?1)").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_teams WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM war_pool_members WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(eventId),
    ]);

    await deleteMediaRefs(this.rawDb as unknown as D1Database, "event", eventId);

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "delete",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
    });
  }

  async uploadEventImages(actorId: string, eventId: string, existing: EventRow, files: File[]): Promise<ServiceResult<{ keys: string[]; attachments: string[] }>> {
    if (files.length === 0) {
      return err("VALIDATION_ERROR", "No files provided");
    }

    const existingAttachments = parseAttachments(existing.attachments);
    const imageResult = await this.storeImages(eventId, files, existingAttachments.length);
    if ("ok" in imageResult && !imageResult.ok) return imageResult;
    const keys = imageResult as string[];
    const attachments = [...existingAttachments, ...keys].slice(0, MAX_EVENT_ATTACHMENTS);

    try {
      await this.db
        .update(events)
        .set({
          attachments: JSON.stringify(attachments),
          updatedAt: this.now(),
        })
        .where(eq(events.id, eventId));

      await replaceMediaRefs(this.rawDb as unknown as D1Database, "event", eventId, attachments);

      await this.deps.writeAuditLog({
        entityType: "event",
        action: "upload_images",
        actorId,
        entityId: eventId,
        diffTitle: existing.title,
        detailText: JSON.stringify({ keys }),
      });
    } catch (error) {
      const rawDb = this.rawDb as unknown as D1Database;
      await rethrowAfterUploadFailure(
        error,
        (key) => Promise.resolve(this.media.delete(key)),
        keys,
        async () => {
          await rawDb.batch([
            rawDb.prepare("UPDATE events SET attachments = ?1, updated_at = ?2 WHERE id = ?3")
              .bind(existing.attachments, existing.updatedAt, eventId),
            ...buildReplaceMediaRefsStatements(rawDb, "event", eventId, existingAttachments),
          ]);
        },
      );
    }

    return ok({ keys, attachments });
  }

  private buildUpdateDiff(existing: EventRow, data: UpdateEventInput): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (data.type !== undefined && data.type !== existing.type)
      diff.type = { from: existing.type, to: data.type };
    if (data.title !== undefined && data.title.trim() !== existing.title)
      diff.title = { from: existing.title, to: data.title.trim() };
    if (data.description !== undefined && (data.description?.trim() || null) !== existing.description)
      diff.description = { from: existing.description, to: data.description?.trim() || null };
    if (data.start_at !== undefined && data.start_at !== existing.startAt)
      diff.start_at = { from: existing.startAt, to: data.start_at };
    if (data.end_at !== undefined && (data.end_at ?? null) !== existing.endAt)
      diff.end_at = { from: existing.endAt, to: data.end_at ?? null };
    if (data.capacity !== undefined && (data.capacity ?? null) !== existing.capacity)
      diff.capacity = { from: existing.capacity, to: data.capacity ?? null };
    if (data.pinned !== undefined && data.pinned !== existing.pinned)
      diff.pinned = { from: existing.pinned, to: data.pinned };
    if (data.signup_locked !== undefined && data.signup_locked !== existing.signupLocked)
      diff.signup_locked = { from: existing.signupLocked, to: data.signup_locked };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    if (data.archived_at !== undefined && (data.archived_at ?? null) !== existing.archivedAt)
      diff.archived_at = { from: existing.archivedAt, to: data.archived_at ?? null };
    if (data.attachments !== undefined) {
      const existingKeys = parseAttachments(existing.attachments);
      if (JSON.stringify(data.attachments) !== JSON.stringify(existingKeys))
        diff.attachments = { from: existingKeys.length, to: data.attachments?.length ?? 0 };
    }
    return diff;
  }

  private validateDateRange(startAt: string | null | undefined, endAt: string | null | undefined): ServiceErr | null {
    if (startAt && endAt && endAt <= startAt) {
      return err("VALIDATION_ERROR", "end_at must be after start_at");
    }
    return null;
  }

  private async storeImages(eventId: string, files: File[], existingAttachmentCount: number): Promise<string[] | ServiceErr> {
    if (files.length === 0) {
      return [];
    }

    if (existingAttachmentCount + files.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const mediaPolicy = await (this.deps.getMediaPolicy?.() ?? Promise.resolve(DEFAULT_SITE_MEDIA_POLICY));
    const maxEventImageBytes = mediaPolicy.max_file_size_bytes.event_image;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
      }
      if (file.size > maxEventImageBytes) {
        return err("VALIDATION_ERROR", `File too large: ${file.name}`);
      }
    }

    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = this.deps.createImageKey?.(eventId) ?? `events/${eventId}/images/${Date.now()}_${nanoid()}`;
        keys.push(key);
        await this.media.put(key, await file.arrayBuffer(), {
          httpMetadata: {
            contentType: file.type || "application/octet-stream",
          },
        });
      }
      return keys;
    } catch (error) {
      return rethrowAfterUploadFailure(
        error,
        (key) => Promise.resolve(this.media.delete(key)),
        keys,
      );
    }
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  // --- Query methods moved from route ---

  static readonly eventSelectFields = {
    id: events.id,
    type: events.type,
    title: events.title,
    description: events.description,
    startAt: events.startAt,
    endAt: events.endAt,
    capacity: events.capacity,
    pinned: events.pinned,
    signupLocked: events.signupLocked,
    visibleAt: events.visibleAt,
    archivedAt: events.archivedAt,
    autoArchive: events.autoArchive,
    autoArchived: events.autoArchived,
    createdBy: events.createdBy,
    updatedBy: events.updatedBy,
    attachments: events.attachments,
    seriesId: events.seriesId,
    instanceDate: events.instanceDate,
    winnerCount: events.winnerCount,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  } as const;

  static buildEventsWhereFilters(params: {
    typeFilter?: string;
    archivedFilter?: boolean;
    pinnedFilter?: boolean;
    lockedFilter?: boolean;
    search?: string;
    startAfter?: string;
    startBefore?: string;
    canManage?: boolean;
    now?: string;
  }): SQL<unknown>[] {
    const filters: SQL<unknown>[] = [];
    if (!params.canManage) {
      filters.push(eventPublicVisibilityFilter(params.now ?? new Date().toISOString()));
    }
    if (params.typeFilter) {
      filters.push(eq(events.type, params.typeFilter as typeof events.type.enumValues[number]));
    }
    if (params.archivedFilter === true) {
      filters.push(isNotNull(events.archivedAt));
    } else if (params.archivedFilter === false) {
      filters.push(isNull(events.archivedAt));
    }
    if (params.pinnedFilter !== undefined) {
      filters.push(eq(events.pinned, params.pinnedFilter));
    }
    if (params.lockedFilter !== undefined) {
      filters.push(eq(events.signupLocked, params.lockedFilter));
    }
    const search = params.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      filters.push(or(likeEscaped(events.title, pattern), likeEscaped(events.description, pattern))!);
    }
    if (params.startAfter) filters.push(gte(events.startAt, params.startAfter));
    if (params.startBefore) filters.push(lte(events.startAt, params.startBefore));
    return filters;
  }

  async getEventById(eventId: string): Promise<EventRow | null> {
    return ((await this.db.select(EventCrudService.eventSelectFields).from(events).where(eq(events.id, eventId)).limit(1)) as EventRow[])[0] ?? null;
  }

  async listEvents(params: {
    page: number; limit: number; typeFilter?: string; archivedFilter?: boolean; pinnedFilter?: boolean; lockedFilter?: boolean; search?: string; startAfter?: string; startBefore?: string; viewerId?: string | null; canManage?: boolean;
  }) {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...EventCrudService.buildEventsWhereFilters({
      ...params,
      now: this.now(),
    }));

    const [rows, countRow] = await Promise.all([
      this.db
        .select(EventCrudService.eventSelectFields)
        .from(events)
        .where(whereClause)
        .orderBy(asc(events.startAt), asc(events.id))
        .offset(offset)
        .limit(params.limit) as Promise<EventRow[]>,
      this.db.select({ count: sql<number>`count(*)` }).from(events).where(whereClause) as Promise<{ count: number }[]>,
    ]);

    const total = Number(countRow[0]?.count ?? 0);

    const data = await this.pollRaffle.attachRaffleWinners(
      await this.pollRaffle.attachPolls(rows.map(toEventPayload), params.viewerId ?? null, params.canManage ?? false),
    );
    return {
      data,
      total,
      page: params.page,
      limit: params.limit,
      total_pages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async getEventDetail(eventId: string, viewerId?: string | null, canManage = false) {
    const eventRow = await this.getEventById(eventId);
    if (!eventRow) return null;
    if (!canManage && !isEventPubliclyVisible(eventRow.visibleAt, this.now())) return null;

    const participants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as EventParticipantRow[];

    const [eventWithPoll] = await this.pollRaffle.attachPolls([toEventPayload(eventRow)], viewerId ?? null, canManage);

    const raffleWinners = eventRow.type === "raffle"
      ? ((await this.db
          .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
          .from(eventRaffleWinners)
          .where(eq(eventRaffleWinners.eventId, eventId))) as RaffleWinnerRow[])
      : [];

    return {
      ...eventWithPoll,
      participants: participants.map(toParticipantPayload),
      raffle_winners: raffleWinners.map(toRaffleWinnerPayload),
    };
  }

  async batchDetails(ids: string[], viewerId?: string | null, canManage = false) {
    const eventRows = (await this.db
      .select(EventCrudService.eventSelectFields)
      .from(events)
      .where(inArray(events.id, ids))) as EventRow[];
    const visibleEventRows = canManage
      ? eventRows
      : eventRows.filter((row) => isEventPubliclyVisible(row.visibleAt, this.now()));
    if (visibleEventRows.length === 0) return [];
    const visibleEventIds = visibleEventRows.map((row) => row.id);

    const allParticipants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, visibleEventIds))) as EventParticipantRow[];

    const eventsWithPolls = await this.pollRaffle.attachRaffleWinners(
      await this.pollRaffle.attachPolls(visibleEventRows.map(toEventPayload), viewerId ?? null, canManage),
    );

    return eventsWithPolls.map((row) => ({
      ...row,
      participants: allParticipants.filter((p) => p.eventId === row.id).map(toParticipantPayload),
    }));
  }

}
