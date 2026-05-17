import { createEventSchema, eventParticipantSchema, eventSchema, recurringTemplateSchema, updateEventSchema, eventRaffleWinnerSchema } from "@guild/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  eventParticipants,
  eventRaffleWinners,
  events,
  users,
} from "../db/schema";
import { escapeLikePattern } from "./helpers";
import { err, ok, type ServiceErr, type ServiceResult } from "./result";

type QueryChain = Promise<unknown[]> & {
  limit: (n: number) => Promise<unknown[]>;
  orderBy: (...cols: unknown[]) => QueryChain;
  offset: (n: number) => QueryChain;
};

type WhereChain = QueryChain & {
  orderBy: (...cols: unknown[]) => QueryChain;
};

type DatabaseLike = {
  insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> | unknown };
  update: (table: unknown) => { set: (values: unknown) => { where: (filter: unknown) => Promise<unknown> | unknown } };
  delete: (table: unknown) => { where: (filter: unknown) => Promise<unknown> | unknown };
  select: (fields: unknown) => {
    from: (table: unknown) => {
      where: (filter: unknown) => WhereChain;
      leftJoin: (table: unknown, on: unknown) => {
        where: (filter: unknown) => WhereChain;
      };
      orderBy: (...cols: unknown[]) => QueryChain;
    };
  };
};

type BoundStatement = {
  run: () => Promise<{ meta?: { changes?: number } }>;
  all?: () => Promise<{ results?: unknown[] } | unknown[]>;
};

type RawDbLike = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => BoundStatement;
  };
  batch: (statements: BoundStatement[]) => Promise<unknown[]>;
};

type MediaLike = {
  put: (key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => Promise<unknown> | unknown;
};

type AuditLogInput = {
  entityType: string;
  action: string;
  actorId: string;
  entityId: string;
  diffTitle?: string | null;
  detailText?: string | null;
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
  recurrenceRule: string | null;
  attachments: string;
  seriesId: string | null;
  isSeriesParent: boolean;
  instanceDate: string | null;
  lastGeneratedDate: string | null;
  generationCount: number;
  visibilityOffsetMinutes: number | null;
  winnerCount: number | null;
  createdAt: string;
  updatedAt: string;
};

type EventParticipantRow = {
  id: string;
  eventId: string;
  userId: string;
  joinedAt: string;
};

type RaffleWinnerRow = {
  id: string;
  eventId: string;
  userId: string;
  drawnAt: string;
};

type PollResultsVisibility = "always" | "after_vote" | "after_close";

type PollOptionRow = {
  id: string;
  eventId: string;
  label: string;
  sortOrder: number;
};

type PollJoinedRow = {
  event_id: string;
  results_visibility: PollResultsVisibility;
  show_voter_names: number | boolean;
  option_id: string;
  label: string;
  sort_order: number;
  voter_id: string | null;
};

const MAX_EVENT_ATTACHMENTS = 5;
const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

type EventServiceDeps = {
  getEventById: (eventId: string) => Promise<EventRow | null>;
  getUsername: (userId: string) => Promise<string | null>;
  materializeRecurringSeries: (templateId: string) => Promise<void>;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (payload: { entityType: string; entityId: string; hint: string }) => Promise<void>;
  now?: () => string;
  createId?: () => string;
  createImageKey?: (eventId: string) => string;
};

type CreateEventInput = z.infer<typeof createEventSchema>;
type UpdateEventInput = z.infer<typeof updateEventSchema>;

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
    recurrence_rule: parseRecurrenceRule(row.recurrenceRule),
    attachments: parseAttachments(row.attachments),
    series_id: row.seriesId,
    is_series_parent: row.isSeriesParent,
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

export function toParticipantPayload(row: EventParticipantRow) {
  const result = eventParticipantSchema.safeParse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    joined_at: row.joinedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid participant data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export function toRaffleWinnerPayload(row: RaffleWinnerRow) {
  const result = eventRaffleWinnerSchema.safeParse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    drawn_at: row.drawnAt,
  });
  if (!result.success) {
    throw new Error(`Invalid raffle winner data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export function toTemplatePayload(row: EventRow) {
  const result = recurringTemplateSchema.safeParse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    capacity: row.capacity,
    recurrence_rule: parseRecurrenceRule(row.recurrenceRule),
    auto_archive: row.autoArchive,
    visibility_offset_minutes: row.visibilityOffsetMinutes ?? null,
    visible_at: row.visibleAt ?? null,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    last_generated_date: row.lastGeneratedDate,
    generation_count: row.generationCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
  if (!result.success) {
    throw new Error(`Invalid template data for id=${row.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

export class EventService {
  private readonly db: DatabaseLike;
  private readonly rawDb: RawDbLike;
  private readonly media: MediaLike;
  private readonly deps: EventServiceDeps;

  constructor(db: DatabaseLike, rawDb: RawDbLike, media: MediaLike, deps: EventServiceDeps) {
    this.db = db;
    this.rawDb = rawDb;
    this.media = media;
    this.deps = deps;
  }

  async createEvent(actorId: string, data: CreateEventInput, files: File[] = []): Promise<ServiceResult<EventRow>> {
    const dateErr = this.validateDateRange(data.start_at, data.end_at);
    if (dateErr) return dateErr;
    const pollErr = this.validatePollEventInput(data);
    if (pollErr) return pollErr;
    const raffleErr = this.validateRaffleEventInput(data);
    if (raffleErr) return raffleErr;

    const eventId = this.deps.createId?.() ?? nanoid();
    const imageResult = await this.storeImages(eventId, files, 0);
    if ("ok" in imageResult && !imageResult.ok) return imageResult;
    const uploadedAttachments = imageResult as string[];
    const attachments = [...(data.attachments ?? []), ...uploadedAttachments];
    if (attachments.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const recurrenceRuleJson = data.recurrence_rule
      ? JSON.stringify(data.recurrence_rule)
      : null;
    const now = this.now();
    const isSeriesParent = recurrenceRuleJson !== null;

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
      recurrenceRule: recurrenceRuleJson,
      attachments: JSON.stringify(attachments),
      seriesId: null,
      isSeriesParent,
      instanceDate: null,
      createdAt: now,
      updatedAt: now,
    });

    if (data.type === "poll" && data.poll) {
      await this.createPoll(eventId, data.poll);
    }

    if (isSeriesParent) {
      await this.deps.materializeRecurringSeries(eventId);
    }

    const created = await this.deps.getEventById(eventId);
    if (!created) {
      throw new Error("Failed to load created event");
    }

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

    return ok(created);
  }

  async updateEvent(actorId: string, eventId: string, existing: EventRow, data: UpdateEventInput): Promise<ServiceResult<EventRow>> {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    const dateErr = this.validateDateRange(effectiveStartAt, effectiveEndAt);
    if (dateErr) return dateErr;
    const pollUpdateErr = this.validatePollEventUpdate(existing, data, effectiveEndAt);
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
    if (data.recurrence_rule !== undefined) {
      patch.recurrenceRule = JSON.stringify(data.recurrence_rule);
      patch.isSeriesParent = true;
    }

    if ((existing.type === "poll" || data.type === "poll") && data.poll && await this.pollHasVotes(eventId) && await this.pollOptionsChanged(eventId, data.poll.options)) {
      return err("VALIDATION_ERROR", "Poll options cannot be changed after voting starts");
    }

    await this.db.update(events).set(patch).where(eq(events.id, eventId));

    if ((existing.type === "poll" || data.type === "poll") && data.poll) {
      const pollErr = await this.updatePoll(eventId, data.poll);
      if (pollErr) return pollErr;
    }

    const updated = await this.deps.getEventById(eventId);
    if (!updated) {
      throw new Error("Failed to load updated event");
    }

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
      this.rawDb.prepare("UPDATE war_templates SET source_event_id = NULL WHERE source_event_id = ?1").bind(eventId),
      this.rawDb.prepare("UPDATE war_history SET event_id = NULL, updated_at = ?1 WHERE event_id = ?2").bind(now, eventId),
      this.rawDb.prepare("DELETE FROM event_raffle_winners WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_polls WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM event_participants WHERE event_id = ?1").bind(eventId),
      this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(eventId),
    ]);

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

    await this.db
      .update(events)
      .set({
        attachments: JSON.stringify(attachments),
        updatedAt: this.now(),
      })
      .where(eq(events.id, eventId));

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "upload_images",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
      detailText: JSON.stringify({ keys }),
    });

    return ok({ keys, attachments });
  }

  // ── Participant Operations ──

  async joinEvent(actorId: string, eventId: string): Promise<
    | { ok: true; participant: EventParticipantRow }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR"; message: string }
  > {
    const participantId = this.deps.createId?.() ?? nanoid();
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.type === "poll") {
      return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    }

    const insertResult = await this.rawDb
      .prepare(
        `INSERT INTO event_participants (id, event_id, user_id)
         SELECT ?1, ?2, ?3
         WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.id = ?2
             AND e.archived_at IS NULL
             AND e.signup_locked = 0
             AND (e.end_at IS NULL OR e.end_at > datetime('now'))
             AND (e.capacity IS NULL OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity)
         )
         AND NOT EXISTS (
           SELECT 1 FROM event_participants p WHERE p.event_id = ?2 AND p.user_id = ?3
         )`,
      )
      .bind(participantId, eventId, actorId)
      .run();

    if ((insertResult.meta?.changes ?? 0) !== 1) {
      if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
      if (eventRow.signupLocked) return { ok: false, code: "CONFLICT", message: "Event signup is locked" };

      const existing = (
        await (this.db as any)
          .select({ id: eventParticipants.id })
          .from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
          .limit(1)
      )[0];
      if (existing) return { ok: false, code: "CONFLICT", message: "Already joined" };

      if (eventRow.capacity !== null) {
        const countRow = (
          await (this.db as any)
            .select({ count: sql<number>`count(*)` })
            .from(eventParticipants)
            .where(eq(eventParticipants.eventId, eventId))
        )[0];
        if (Number(countRow?.count ?? 0) >= eventRow.capacity) {
          return { ok: false, code: "CONFLICT", message: "Event is full" };
        }
      }
      return { ok: false, code: "SERVER_ERROR", message: "Failed to join event" };
    }

    const [eventTitle, actorName] = await Promise.all([
      this.resolveEventTitle(eventId),
      this.deps.getUsername(actorId),
    ]);

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "join",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: `${eventTitle} | ${actorName ?? actorId}`,
    });

    const created = (
      await (this.db as any)
        .select({
          id: eventParticipants.id,
          eventId: eventParticipants.eventId,
          userId: eventParticipants.userId,
          joinedAt: eventParticipants.joinedAt,
        })
        .from(eventParticipants)
        .where(eq(eventParticipants.id, participantId))
        .limit(1)
    )[0] as EventParticipantRow | undefined;

    if (!created) return { ok: false, code: "SERVER_ERROR", message: "Failed to create participant" };

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participant_joined",
    });

    return { ok: true, participant: created };
  }

  async leaveEvent(actorId: string, eventId: string): Promise<
    | { ok: true }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string }
  > {
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.type === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    if (eventRow.signupLocked) return { ok: false, code: "CONFLICT", message: "Event signup is locked" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const existing = (
      await (this.db as any)
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
        .limit(1)
    )[0];

    if (!existing) return { ok: false, code: "CONFLICT", message: "Not a participant" };

    await (this.db as any)
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)));

    const [eventTitle, actorName] = await Promise.all([
      this.resolveEventTitle(eventId),
      this.deps.getUsername(actorId),
    ]);

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "leave",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: `${eventTitle} | ${actorName ?? actorId}`,
    });
    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participant_left",
    });

    return { ok: true };
  }

  async addParticipants(
    actorId: string,
    eventId: string,
    targetUserIds: string[],
  ): Promise<
    | { ok: true; participants: EventParticipantRow[] }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "SERVER_ERROR"; message: string }
  > {
    const userIds = [...new Set(targetUserIds.filter((id) => id.trim().length > 0))];
    if (userIds.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "At least one user_id is required" };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.type === "poll") return { ok: false, code: "CONFLICT", message: "Poll events do not support signups" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const activeUserRows = (await (this.db as any)
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.isActive, true), isNull(users.deletedAt)))) as Array<{ id?: string; userId?: string }>;
    const activeUserIds = new Set(activeUserRows.map((row) => row.id ?? row.userId).filter((id): id is string => typeof id === "string"));
    const missingUserId = userIds.find((userId) => !activeUserIds.has(userId));
    if (missingUserId) return { ok: false, code: "NOT_FOUND", message: `User not found: ${missingUserId}` };

    const existingRows = (await (this.db as any)
      .select({ userId: eventParticipants.userId })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), inArray(eventParticipants.userId, userIds)))) as Array<{ userId: string }>;
    const existingUserIds = new Set(existingRows.map((row) => row.userId));
    const insertUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
    if (insertUserIds.length === 0) return { ok: true, participants: [] };

    if (eventRow.capacity !== null && eventRow.capacity > 0) {
      const countRow = (
        await (this.db as any)
          .select({ count: sql<number>`count(*)` })
          .from(eventParticipants)
          .where(eq(eventParticipants.eventId, eventId))
      )[0];
      if (Number(countRow?.count ?? 0) + insertUserIds.length > eventRow.capacity) {
        return { ok: false, code: "CONFLICT", message: "Event has reached maximum capacity" };
      }
    }

    const participantIds = insertUserIds.map(() => this.deps.createId?.() ?? nanoid());
    const stmts = insertUserIds.map((userId, index) =>
      this.rawDb
        .prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?1, ?2, ?3)")
        .bind(participantIds[index], eventId, userId),
    );
    await this.rawDb.batch(stmts);

    const createdRows = (await (this.db as any)
      .select({
        id: eventParticipants.id,
        eventId: eventParticipants.eventId,
        userId: eventParticipants.userId,
        joinedAt: eventParticipants.joinedAt,
      })
      .from(eventParticipants)
      .where(inArray(eventParticipants.id, participantIds))) as EventParticipantRow[];

    const eventTitle = await this.resolveEventTitle(eventId);
    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "batch_add_by_moderator",
      actorId,
      entityId: eventId,
      diffTitle: eventTitle,
      detailText: JSON.stringify({ count: insertUserIds.length, user_ids: insertUserIds }),
    });
    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participants_added_by_moderator",
    });

    return { ok: true, participants: createdRows };
  }

  async votePoll(actorId: string, eventId: string, optionIds: string[]): Promise<
    | { ok: true }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "SERVER_ERROR"; message: string }
  > {
    const uniqueOptionIds = [...new Set(optionIds.filter((id) => id.trim().length > 0))];
    if (uniqueOptionIds.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "At least one option_id is required" };
    if (uniqueOptionIds.length > 10) return { ok: false, code: "VALIDATION_ERROR", message: "Maximum 10 options per vote" };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.type !== "poll") return { ok: false, code: "CONFLICT", message: "Event is not a poll" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (!eventRow.endAt) return { ok: false, code: "CONFLICT", message: "Poll has no close time" };
    if (eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Poll is closed" };

    const validOptions = await this.getPollOptions(eventId);
    if (validOptions.length > 0) {
      const validIds = new Set(validOptions.map((option) => option.id));
      if (uniqueOptionIds.some((id) => !validIds.has(id))) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Invalid poll option" };
      }
    }

    const now = this.now();
    const deleteStmt = this.rawDb.prepare("DELETE FROM event_poll_votes WHERE event_id = ?1 AND user_id = ?2").bind(eventId, actorId);
    const insertStmts = uniqueOptionIds.map((optionId) =>
      this.rawDb
        .prepare("INSERT INTO event_poll_votes (id, event_id, option_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, optionId, actorId, now),
    );
    await this.rawDb.batch([deleteStmt, ...insertStmts]);

    await this.deps.writeAuditLog({
      entityType: "event_poll_vote",
      action: "vote",
      actorId,
      entityId: `${eventId}:${actorId}`,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ option_count: uniqueOptionIds.length }),
    });
    await this.deps.publishEntityChanged({ entityType: "event", entityId: eventId, hint: "poll_voted" });
    return { ok: true };
  }

  // ── Template CRUD ──

  async removeParticipants(actorId: string, eventId: string, targetUserIds: string[]): Promise<
    | { ok: true; removed: number }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT"; message: string }
  > {
    const userIds = [...new Set(targetUserIds.filter((id) => id.trim().length > 0))];
    if (userIds.length === 0) return { ok: true, removed: 0 };

    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (eventRow.endAt && eventRow.endAt <= this.now()) return { ok: false, code: "CONFLICT", message: "Event has ended" };

    const placeholders = userIds.map((_, index) => `?${index + 2}`).join(", ");
    const result = await this.rawDb
      .prepare(`DELETE FROM event_participants WHERE event_id = ?1 AND user_id IN (${placeholders})`)
      .bind(eventId, ...userIds)
      .run();
    const removed = Number(result.meta?.changes ?? 0);
    if (removed > 0) {
      const eventTitle = await this.resolveEventTitle(eventId);
      await this.deps.writeAuditLog({
        entityType: "event_participant",
        action: "batch_remove_by_moderator",
        actorId,
        entityId: eventId,
        diffTitle: eventTitle,
        detailText: JSON.stringify({ count: removed, user_ids: userIds }),
      });
      await this.deps.publishEntityChanged({
        entityType: "event",
        entityId: eventId,
        hint: "participants_removed_by_moderator",
      });
    }
    return { ok: true, removed };
  }

  async createTemplate(actorId: string, data: {
    type: string;
    title: string;
    description?: string | null;
    start_at: string;
    end_at?: string | null;
    capacity?: number | null;
    recurrence_rule: unknown;
    visibility_offset_minutes?: number | null;
    auto_archive?: boolean;
  }): Promise<ServiceResult<EventRow>> {
    const dateErr = this.validateDateRange(data.start_at, data.end_at);
    if (dateErr) return dateErr;

    const templateId = this.deps.createId?.() ?? nanoid();
    const recurrenceRuleJson = JSON.stringify(data.recurrence_rule);

    await this.db.insert(events).values({
      id: templateId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      startAt: data.start_at,
      endAt: data.end_at ?? null,
      capacity: data.capacity ?? null,
      pinned: false,
      signupLocked: false,
      autoArchive: data.auto_archive ?? false,
      autoArchived: false,
      archivedAt: null,
      createdBy: actorId,
      recurrenceRule: recurrenceRuleJson,
      attachments: "[]",
      seriesId: null,
      isSeriesParent: true,
      instanceDate: null,
      lastGeneratedDate: null,
      generationCount: 0,
      visibilityOffsetMinutes: data.visibility_offset_minutes ?? null,
    });

    const created = await this.deps.getEventById(templateId);
    if (!created) throw new Error("Failed to load created template");

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "create",
      actorId,
      entityId: templateId,
      diffTitle: created.title,
      detailText: JSON.stringify({ recurrence_rule: data.recurrence_rule }),
    });

    return ok(created);
  }

  async updateTemplate(actorId: string, templateId: string, existing: EventRow, data: {
    type?: string;
    title?: string;
    description?: string | null;
    start_at?: string;
    end_at?: string | null;
    capacity?: number | null;
    recurrence_rule?: unknown;
    visibility_offset_minutes?: number | null;
    auto_archive?: boolean;
  }): Promise<ServiceResult<EventRow>> {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    const dateErr = this.validateDateRange(effectiveStartAt, effectiveEndAt);
    if (dateErr) return dateErr;

    const patch: Record<string, unknown> = { updatedAt: this.now() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.start_at !== undefined) patch.startAt = data.start_at;
    if (data.end_at !== undefined) patch.endAt = data.end_at;
    if (data.capacity !== undefined) patch.capacity = data.capacity;
    if (data.recurrence_rule !== undefined) {
      patch.recurrenceRule = JSON.stringify(data.recurrence_rule);
    }
    if (data.visibility_offset_minutes !== undefined) {
      patch.visibilityOffsetMinutes = data.visibility_offset_minutes;
    }
    if (data.auto_archive !== undefined) {
      patch.autoArchive = data.auto_archive;
    }

    if (data.start_at !== undefined || data.recurrence_rule !== undefined) {
      patch.lastGeneratedDate = null;
      patch.generationCount = 0;
    }

    await this.db.update(events).set(patch).where(eq(events.id, templateId));

    const updated = await this.deps.getEventById(templateId);
    if (!updated) throw new Error("Failed to load updated template");

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "update",
      actorId,
      entityId: templateId,
      diffTitle: updated.title,
      detailText: JSON.stringify(this.buildTemplateUpdateDiff(existing, data)),
    });

    if (data.start_at !== undefined || data.recurrence_rule !== undefined) {
      await this.deps.materializeRecurringSeries(templateId);
    }

    return ok(updated);
  }

  async pauseTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    const now = this.now();
    await this.db.update(events).set({ archivedAt: now, updatedAt: now }).where(eq(events.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "pause",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  async resumeTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    const now = this.now();
    await this.db.update(events).set({ archivedAt: null, updatedAt: now }).where(eq(events.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "resume",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });

    await this.deps.materializeRecurringSeries(templateId);
  }

  async deleteTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    await this.rawDb.batch([
      this.rawDb.prepare("UPDATE events SET series_id = NULL WHERE series_id = ?1").bind(templateId),
      this.rawDb.prepare("DELETE FROM events WHERE id = ?1").bind(templateId),
    ]);

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "delete",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  private async resolveEventTitle(eventId: string): Promise<string> {
    const row = await this.deps.getEventById(eventId);
    return row?.title ?? eventId;
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
    if (data.recurrence_rule !== undefined)
      diff.recurrence_rule = { from: "changed", to: "changed" };
    return diff;
  }

  private buildTemplateUpdateDiff(existing: EventRow, data: {
    type?: string; title?: string; description?: string | null; start_at?: string;
    end_at?: string | null; capacity?: number | null; recurrence_rule?: unknown; visibility_offset_minutes?: number | null;
    auto_archive?: boolean;
  }): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (data.type !== undefined && data.type !== existing.type)
      diff.type = { from: existing.type, to: data.type };
    if (data.title !== undefined && data.title !== existing.title)
      diff.title = { from: existing.title, to: data.title };
    if (data.description !== undefined && (data.description ?? null) !== existing.description)
      diff.description = { from: existing.description, to: data.description ?? null };
    if (data.start_at !== undefined && data.start_at !== existing.startAt)
      diff.start_at = { from: existing.startAt, to: data.start_at };
    if (data.end_at !== undefined && (data.end_at ?? null) !== existing.endAt)
      diff.end_at = { from: existing.endAt, to: data.end_at ?? null };
    if (data.capacity !== undefined && (data.capacity ?? null) !== existing.capacity)
      diff.capacity = { from: existing.capacity, to: data.capacity ?? null };
    if (data.recurrence_rule !== undefined)
      diff.recurrence_rule = { from: "changed", to: "changed" };
    if (data.visibility_offset_minutes !== undefined && (data.visibility_offset_minutes ?? null) !== (existing.visibilityOffsetMinutes ?? null))
      diff.visibility_offset_minutes = { from: existing.visibilityOffsetMinutes, to: data.visibility_offset_minutes ?? null };
    if (data.auto_archive !== undefined && data.auto_archive !== existing.autoArchive)
      diff.auto_archive = { from: existing.autoArchive, to: data.auto_archive };
    return diff;
  }

  // ── Raffle Operations ──

  async drawRaffleWinners(actorId: string, eventId: string): Promise<
    | { ok: true; winners: RaffleWinnerRow[] }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR"; message: string }
  > {
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
    if (eventRow.type !== "raffle") return { ok: false, code: "CONFLICT", message: "Event is not a raffle" };
    if (eventRow.archivedAt !== null) return { ok: false, code: "CONFLICT", message: "Event is archived" };
    if (!eventRow.winnerCount || eventRow.winnerCount < 1) return { ok: false, code: "VALIDATION_ERROR", message: "Raffle has no winner_count configured" };

    const existingWinners = await this.rawDb
      .prepare("SELECT id FROM event_raffle_winners WHERE event_id = ?1 LIMIT 1")
      .bind(eventId)
      .all?.();
    const hasWinners = Array.isArray(existingWinners) ? existingWinners.length > 0 : (existingWinners?.results?.length ?? 0) > 0;
    if (hasWinners) return { ok: false, code: "CONFLICT", message: "Raffle winners already drawn" };

    const participantRows = (await (this.db as any)
      .select({ userId: eventParticipants.userId })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as Array<{ userId: string }>;

    if (participantRows.length === 0) return { ok: false, code: "VALIDATION_ERROR", message: "No participants to draw from" };

    const pool = participantRows.map((row) => row.userId);
    const winnerCount = Math.min(eventRow.winnerCount, pool.length);
    const selectedIds: string[] = [];
    const remaining = [...pool];
    for (let i = 0; i < winnerCount; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      selectedIds.push(remaining[idx]!);
      remaining.splice(idx, 1);
    }

    const now = this.now();
    const stmts = selectedIds.map((userId) =>
      this.rawDb
        .prepare("INSERT INTO event_raffle_winners (id, event_id, user_id, drawn_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, userId, now),
    );
    stmts.push(
      this.rawDb
        .prepare("UPDATE events SET signup_locked = 1, updated_at = ?1 WHERE id = ?2")
        .bind(now, eventId),
    );
    await this.rawDb.batch(stmts);

    const winners = (await (this.db as any)
      .select({ id: eventRaffleWinners.id, eventId: eventRaffleWinners.eventId, userId: eventRaffleWinners.userId, drawnAt: eventRaffleWinners.drawnAt })
      .from(eventRaffleWinners)
      .where(eq(eventRaffleWinners.eventId, eventId))) as RaffleWinnerRow[];

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "raffle_draw",
      actorId,
      entityId: eventId,
      diffTitle: eventRow.title,
      detailText: JSON.stringify({ winner_count: winners.length, winner_user_ids: selectedIds }),
    });

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "raffle_drawn",
    });

    return { ok: true, winners };
  }

  async hasRaffleWinners(eventId: string): Promise<boolean> {
    const result = await this.rawDb
      .prepare("SELECT id FROM event_raffle_winners WHERE event_id = ?1 LIMIT 1")
      .bind(eventId)
      .all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) && rows.length > 0;
  }

  private async attachRaffleWinners<T extends { id: string; type: string }>(eventPayloads: T[]): Promise<(T & { raffle_winners?: Array<{ id: string; event_id: string; user_id: string; drawn_at: string }> })[]> {
    const raffleIds = eventPayloads.filter((e) => e.type === "raffle").map((e) => e.id);
    if (raffleIds.length === 0) return eventPayloads;

    const placeholders = raffleIds.map((_, i) => `?${i + 1}`).join(", ");
    const result = await this.rawDb
      .prepare(`SELECT id, event_id, user_id, drawn_at FROM event_raffle_winners WHERE event_id IN (${placeholders})`)
      .bind(...raffleIds)
      .all?.();
    const rawRows = ((result as { results?: unknown[] } | undefined)?.results ?? []) as Array<{ id: string; event_id: string; user_id: string; drawn_at: string }>;
    const rows: RaffleWinnerRow[] = rawRows.map((r) => ({ id: r.id, eventId: r.event_id, userId: r.user_id, drawnAt: r.drawn_at }));

    const winnersByEvent = new Map<string, RaffleWinnerRow[]>();
    for (const row of rows) {
      const list = winnersByEvent.get(row.eventId) ?? [];
      list.push(row);
      winnersByEvent.set(row.eventId, list);
    }

    return eventPayloads.map((e) => {
      if (e.type !== "raffle") return e;
      return { ...e, raffle_winners: (winnersByEvent.get(e.id) ?? []).map(toRaffleWinnerPayload) };
    });
  }

  private validateDateRange(startAt: string | null | undefined, endAt: string | null | undefined): ServiceErr | null {
    if (startAt && endAt && endAt <= startAt) {
      return err("VALIDATION_ERROR", "end_at must be after start_at");
    }
    return null;
  }

  private validatePollEventInput(data: CreateEventInput): ServiceErr | null {
    if (data.type !== "poll") return null;
    if (!data.end_at) return err("VALIDATION_ERROR", "Poll events require end_at");
    if (!data.poll) return err("VALIDATION_ERROR", "Poll events require poll settings");
    if (data.recurrence_rule) return err("VALIDATION_ERROR", "Poll events cannot recur");
    return null;
  }

  private validateRaffleEventInput(data: CreateEventInput): ServiceErr | null {
    if (data.type !== "raffle") return null;
    if (!data.end_at) return err("VALIDATION_ERROR", "Raffle events require end_at");
    if (!data.winner_count || data.winner_count < 1) return err("VALIDATION_ERROR", "Raffle events require winner_count");
    if (data.recurrence_rule) return err("VALIDATION_ERROR", "Raffle events cannot recur");
    return null;
  }

  private validatePollEventUpdate(existing: EventRow, data: UpdateEventInput, effectiveEndAt: string | null): ServiceErr | null {
    const effectiveType = data.type ?? existing.type;
    if (effectiveType !== "poll") {
      if (data.poll) return err("VALIDATION_ERROR", "Only poll events can include poll settings");
      return null;
    }
    if (!effectiveEndAt) return err("VALIDATION_ERROR", "Poll events require end_at");
    if (data.recurrence_rule) return err("VALIDATION_ERROR", "Poll events cannot recur");
    return null;
  }

  private async createPoll(eventId: string, poll: NonNullable<CreateEventInput["poll"]>) {
    const now = this.now();
    const pollStmt = this.rawDb
      .prepare("INSERT INTO event_polls (event_id, results_visibility, show_voter_names, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(eventId, poll.results_visibility ?? "after_vote", poll.show_voter_names ?? false, now, now);
    const optionStmts = poll.options.map((label, index) =>
      this.rawDb
        .prepare("INSERT INTO event_poll_options (id, event_id, label, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(this.deps.createId?.() ?? nanoid(), eventId, label.trim(), index, now),
    );
    await this.rawDb.batch([pollStmt, ...optionStmts]);
  }

  private async updatePoll(eventId: string, poll: NonNullable<CreateEventInput["poll"]>): Promise<ServiceErr | null> {
    const hasVotes = await this.pollHasVotes(eventId);
    const now = this.now();
    const stmts = [
      this.rawDb
        .prepare("UPDATE event_polls SET results_visibility = ?1, show_voter_names = ?2, updated_at = ?3 WHERE event_id = ?4")
        .bind(poll.results_visibility ?? "after_vote", poll.show_voter_names ?? false, now, eventId),
    ];
    if (!hasVotes) {
      stmts.push(this.rawDb.prepare("DELETE FROM event_poll_options WHERE event_id = ?1").bind(eventId));
      stmts.push(...poll.options.map((label, index) =>
        this.rawDb
          .prepare("INSERT INTO event_poll_options (id, event_id, label, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(this.deps.createId?.() ?? nanoid(), eventId, label.trim(), index, now),
      ));
    } else if (await this.pollOptionsChanged(eventId, poll.options)) {
      return err("VALIDATION_ERROR", "Poll options cannot be changed after voting starts");
    }
    await this.rawDb.batch(stmts);
    return null;
  }

  private async pollOptionsChanged(eventId: string, nextOptions: string[]): Promise<boolean> {
    const existing = await this.getPollOptions(eventId);
    if (existing.length === 0) return false;
    const existingLabels = existing.sort((left, right) => left.sortOrder - right.sortOrder).map((option) => option.label.trim());
    const nextLabels = nextOptions.map((option) => option.trim());
    return JSON.stringify(existingLabels) !== JSON.stringify(nextLabels);
  }

  private async pollHasVotes(eventId: string): Promise<boolean> {
    const statement = this.rawDb.prepare("SELECT id FROM event_poll_votes WHERE event_id = ?1 LIMIT 1").bind(eventId);
    const result = await statement.all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) && rows.length > 0;
  }

  private async getPollOptions(eventId: string): Promise<PollOptionRow[]> {
    const statement = this.rawDb.prepare("SELECT id, event_id as eventId, label, sort_order as sortOrder FROM event_poll_options WHERE event_id = ?1").bind(eventId);
    const result = await statement.all?.();
    const rows = Array.isArray(result) ? result : result?.results;
    return Array.isArray(rows) ? rows as PollOptionRow[] : [];
  }

  private async storeImages(eventId: string, files: File[], existingAttachmentCount: number): Promise<string[] | ServiceErr> {
    if (files.length === 0) {
      return [];
    }

    if (existingAttachmentCount + files.length > MAX_EVENT_ATTACHMENTS) {
      return err("VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const keys: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return err("VALIDATION_ERROR", `Invalid file type: ${file.name}`);
      }
      if (file.size > MAX_EVENT_IMAGE_BYTES) {
        return err("VALIDATION_ERROR", `File too large: ${file.name}`);
      }
      const key = this.deps.createImageKey?.(eventId) ?? `events/${eventId}/images/${Date.now()}_${nanoid()}`;
      await this.media.put(key, await file.arrayBuffer(), {
        httpMetadata: {
          contentType: file.type || "application/octet-stream",
        },
      });
      keys.push(key);
    }
    return keys;
  }

  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  // --- Query methods moved from route ---

  private static readonly eventSelectFields = {
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
    recurrenceRule: events.recurrenceRule,
    attachments: events.attachments,
    seriesId: events.seriesId,
    isSeriesParent: events.isSeriesParent,
    instanceDate: events.instanceDate,
    lastGeneratedDate: events.lastGeneratedDate,
    generationCount: events.generationCount,
    visibilityOffsetMinutes: events.visibilityOffsetMinutes,
    winnerCount: events.winnerCount,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  } as const;

  private static buildEventsWhereFilters(params: {
    typeFilter?: string;
    archivedFilter?: boolean;
    pinnedFilter?: boolean;
    lockedFilter?: boolean;
    search?: string;
    startAfter?: string;
    startBefore?: string;
  }): SQL<unknown>[] {
    const filters: SQL<unknown>[] = [eq(events.isSeriesParent, false)];
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
      filters.push(or(like(events.title, pattern), like(events.description, pattern))!);
    }
    if (params.startAfter) filters.push(gte(events.startAt, params.startAfter));
    if (params.startBefore) filters.push(lte(events.startAt, params.startBefore));
    return filters;
  }

  async getEventById(eventId: string): Promise<EventRow | null> {
    return ((await this.db.select(EventService.eventSelectFields).from(events).where(eq(events.id, eventId)).limit(1)) as EventRow[])[0] ?? null;
  }

  async listEvents(params: {
    page: number; limit: number; typeFilter?: string; archivedFilter?: boolean; pinnedFilter?: boolean; lockedFilter?: boolean; search?: string; startAfter?: string; startBefore?: string; viewerId?: string | null; canManage?: boolean;
  }) {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...EventService.buildEventsWhereFilters(params));

    const [rows, countRow] = await Promise.all([
      this.db
        .select(EventService.eventSelectFields)
        .from(events)
        .where(whereClause)
        .orderBy(asc(events.startAt), asc(events.id))
        .offset(offset)
        .limit(params.limit) as Promise<EventRow[]>,
      this.db.select({ count: sql<number>`count(*)` }).from(events).where(whereClause) as Promise<{ count: number }[]>,
    ]);

    const total = Number(countRow[0]?.count ?? 0);

    const data = await this.attachRaffleWinners(
      await this.attachPolls(rows.map(toEventPayload), params.viewerId ?? null, params.canManage ?? false),
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

    const participants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as EventParticipantRow[];

    const [eventWithPoll] = await this.attachPolls([toEventPayload(eventRow)], viewerId ?? null, canManage);

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
      .select(EventService.eventSelectFields)
      .from(events)
      .where(inArray(events.id, ids))) as EventRow[];

    const allParticipants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, ids))) as EventParticipantRow[];

    const eventsWithPolls = await this.attachRaffleWinners(
      await this.attachPolls(eventRows.map(toEventPayload), viewerId ?? null, canManage),
    );

    return eventsWithPolls.map((row) => ({
      ...row,
      participants: allParticipants.filter((p) => p.eventId === row.id).map(toParticipantPayload),
    }));
  }

  async listTemplates() {
    const rows = (await this.db
      .select(EventService.eventSelectFields)
      .from(events)
      .where(eq(events.isSeriesParent, true))
      .orderBy(asc(events.createdAt), asc(events.id))) as EventRow[];

    return rows.map(toTemplatePayload);
  }

  private async attachPolls<T extends { id: string; type: string; end_at: string | null }>(
    eventPayloads: T[],
    viewerId: string | null,
    canManage: boolean,
  ): Promise<Array<T & { poll?: unknown }>> {
    const pollEvents = eventPayloads.filter((event) => event.type === "poll");
    if (pollEvents.length === 0) return eventPayloads;
    const pollMap = await this.loadPollsForEvents(pollEvents, viewerId, canManage);
    return eventPayloads.map((event) => ({
      ...event,
      poll: pollMap.get(event.id) ?? null,
    }));
  }

  private async loadPollsForEvents(
    pollEvents: Array<{ id: string; end_at: string | null }>,
    viewerId: string | null,
    canManage: boolean,
  ) {
    const placeholders = pollEvents.map((_, index) => `?${index + 1}`).join(", ");
    const statement = this.rawDb
      .prepare(
        `SELECT p.event_id, p.results_visibility, p.show_voter_names,
                o.id as option_id, o.label, o.sort_order, v.user_id as voter_id
         FROM event_polls p
         JOIN event_poll_options o ON o.event_id = p.event_id
         LEFT JOIN event_poll_votes v ON v.option_id = o.id
         WHERE p.event_id IN (${placeholders})
         ORDER BY p.event_id, o.sort_order, o.id`,
      )
      .bind(...pollEvents.map((event) => event.id));
    const result = await statement.all?.();
    const rows = (Array.isArray(result) ? result : result?.results) as PollJoinedRow[] | undefined;
    const rowsByEvent = new Map<string, PollJoinedRow[]>();
    for (const row of rows ?? []) {
      rowsByEvent.set(row.event_id, [...(rowsByEvent.get(row.event_id) ?? []), row]);
    }

    const map = new Map<string, unknown>();
    for (const event of pollEvents) {
      const eventRows = rowsByEvent.get(event.id) ?? [];
      if (eventRows.length === 0) {
        map.set(event.id, null);
        continue;
      }
      const visibility = eventRows[0]?.results_visibility ?? "after_vote";
      const showVoterNames = Boolean(eventRows[0]?.show_voter_names);
      const voterIds = new Set(eventRows.map((row) => row.voter_id).filter((id): id is string => Boolean(id)));
      const hasVoted = viewerId ? voterIds.has(viewerId) : false;
      const isClosed = Boolean(event.end_at && event.end_at <= this.now());
      const resultsVisible = canManage || visibility === "always" || (visibility === "after_vote" && hasVoted) || (visibility === "after_close" && isClosed);
      const optionsById = new Map<string, { id: string; label: string; sortOrder: number; voterIds: string[] }>();
      for (const row of eventRows) {
        const option = optionsById.get(row.option_id) ?? { id: row.option_id, label: row.label, sortOrder: row.sort_order, voterIds: [] };
        if (row.voter_id) option.voterIds.push(row.voter_id);
        optionsById.set(row.option_id, option);
      }
      map.set(event.id, {
        results_visibility: visibility,
        show_voter_names: showVoterNames,
        has_voted: hasVoted,
        can_vote: Boolean(viewerId) && !isClosed,
        options: [...optionsById.values()]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((option) => ({
            id: option.id,
            label: option.label,
            vote_count: resultsVisible ? option.voterIds.length : 0,
            voter_ids: resultsVisible && (showVoterNames || canManage) ? option.voterIds : [],
            voted_by_me: viewerId ? option.voterIds.includes(viewerId) : false,
          })),
      });
    }
    return map;
  }
}
