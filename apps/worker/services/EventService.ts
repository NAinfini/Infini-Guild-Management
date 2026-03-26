import { createEventSchema, eventParticipantSchema, eventSchema, recurringTemplateSchema, updateEventSchema } from "@guild/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  botDeliveryLog,
  botDiscordEventMessages,
  botWechatEventMessages,
  eventParticipants,
  events,
  users,
  warHistory,
  warTemplates,
} from "../db/schema";

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

type RawDbLike = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      run: () => Promise<{ meta?: { changes?: number } }>;
    };
  };
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
  archivedAt: string | null;
  createdBy: string;
  recurrenceRule: string | null;
  attachments: string;
  seriesId: string | null;
  isSeriesParent: boolean;
  instanceDate: string | null;
  lastGeneratedDate: string | null;
  generationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EventParticipantRow = {
  id: string;
  eventId: string;
  userId: string;
  joinedAt: string;
};

export const MAX_EVENT_ATTACHMENTS = 5;
export const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

export class EventServiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventServiceValidationError";
  }
}

type EventServiceDeps = {
  getEventById: (eventId: string) => Promise<EventRow | null>;
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
  return eventSchema.parse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    capacity: row.capacity,
    pinned: row.pinned,
    signup_locked: row.signupLocked,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    recurrence_rule: parseRecurrenceRule(row.recurrenceRule),
    attachments: parseAttachments(row.attachments),
    series_id: row.seriesId,
    is_series_parent: row.isSeriesParent,
    instance_date: row.instanceDate,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export function toParticipantPayload(row: EventParticipantRow) {
  return eventParticipantSchema.parse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    joined_at: row.joinedAt,
  });
}

export function toTemplatePayload(row: EventRow) {
  return recurringTemplateSchema.parse({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    start_at: row.startAt,
    end_at: row.endAt,
    capacity: row.capacity,
    recurrence_rule: parseRecurrenceRule(row.recurrenceRule),
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    last_generated_date: row.lastGeneratedDate,
    generation_count: row.generationCount,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
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

  async createEvent(actorId: string, data: CreateEventInput, files: File[] = []) {
    this.validateDateRange(data.start_at, data.end_at);

    const eventId = this.deps.createId?.() ?? nanoid();
    const uploadedAttachments = await this.storeImages(eventId, files, 0);
    const attachments = [...(data.attachments ?? []), ...uploadedAttachments];
    if (attachments.length > MAX_EVENT_ATTACHMENTS) {
      throw new EventServiceValidationError(`Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
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
      capacity: data.capacity ?? null,
      pinned: false,
      signupLocked: false,
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

    return created;
  }

  async updateEvent(actorId: string, eventId: string, existing: EventRow, data: UpdateEventInput) {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    this.validateDateRange(effectiveStartAt, effectiveEndAt);

    const patch: Record<string, unknown> = {
      updatedAt: this.now(),
    };

    if (data.type !== undefined) patch.type = data.type;
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.description !== undefined) patch.description = data.description?.trim() || null;
    if (data.start_at !== undefined) patch.startAt = data.start_at;
    if (data.end_at !== undefined) patch.endAt = data.end_at ?? null;
    if (data.capacity !== undefined) patch.capacity = data.capacity ?? null;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.signup_locked !== undefined) patch.signupLocked = data.signup_locked;
    if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;
    if (data.attachments !== undefined) patch.attachments = JSON.stringify(data.attachments);
    if (data.recurrence_rule !== undefined) {
      patch.recurrenceRule = JSON.stringify(data.recurrence_rule);
      patch.isSeriesParent = true;
    }

    await this.db.update(events).set(patch).where(eq(events.id, eventId));

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
      detailText: JSON.stringify(data),
    });

    return updated;
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
    await this.db.delete(botDiscordEventMessages).where(eq(botDiscordEventMessages.eventId, eventId));
    await this.db.delete(botWechatEventMessages).where(eq(botWechatEventMessages.eventId, eventId));
    await this.db.delete(botDeliveryLog).where(eq(botDeliveryLog.eventId, eventId));
    await this.db.update(warTemplates).set({ sourceEventId: null }).where(eq(warTemplates.sourceEventId, eventId));
    await this.db
      .update(warHistory)
      .set({
        eventId: null,
        updatedAt: now,
      })
      .where(eq(warHistory.eventId, eventId));
    await this.db.delete(eventParticipants).where(eq(eventParticipants.eventId, eventId));
    await this.db.delete(events).where(eq(events.id, eventId));

    await this.deps.writeAuditLog({
      entityType: "event",
      action: "delete",
      actorId,
      entityId: eventId,
      diffTitle: existing.title,
    });
  }

  async uploadEventImages(actorId: string, eventId: string, existing: EventRow, files: File[]) {
    if (files.length === 0) {
      throw new EventServiceValidationError("No files provided");
    }

    const existingAttachments = parseAttachments(existing.attachments);
    const keys = await this.storeImages(eventId, files, existingAttachments.length);
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

    return { keys, attachments };
  }

  // ── Participant Operations ──

  async joinEvent(actorId: string, eventId: string): Promise<
    | { ok: true; participant: EventParticipantRow }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR"; message: string }
  > {
    const participantId = this.deps.createId?.() ?? nanoid();

    const insertResult = await this.rawDb
      .prepare(
        `INSERT INTO event_participants (id, event_id, user_id)
         SELECT ?1, ?2, ?3
         WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.id = ?2
             AND e.archived_at IS NULL
             AND e.signup_locked = 0
             AND (e.capacity IS NULL OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity)
         )
         AND NOT EXISTS (
           SELECT 1 FROM event_participants p WHERE p.event_id = ?2 AND p.user_id = ?3
         )`,
      )
      .bind(participantId, eventId, actorId)
      .run();

    if ((insertResult.meta?.changes ?? 0) !== 1) {
      const eventRow = await this.deps.getEventById(eventId);
      if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };
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

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "join",
      actorId,
      entityId: `${eventId}:${actorId}`,
      detailText: JSON.stringify({ event_id: eventId, user_id: actorId }),
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

  async leaveEvent(actorId: string, eventId: string): Promise<void> {
    const existing = (
      await (this.db as any)
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)))
        .limit(1)
    )[0];

    await (this.db as any)
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, actorId)));

    if (existing) {
      await this.deps.writeAuditLog({
        entityType: "event_participant",
        action: "leave",
        actorId,
        entityId: `${eventId}:${actorId}`,
        detailText: JSON.stringify({ event_id: eventId, user_id: actorId }),
      });
      await this.deps.publishEntityChanged({
        entityType: "event",
        entityId: eventId,
        hint: "participant_left",
      });
    }
  }

  async addParticipant(
    actorId: string,
    eventId: string,
    targetUserId: string,
  ): Promise<
    | { ok: true; participant: EventParticipantRow }
    | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "SERVER_ERROR"; message: string }
  > {
    const eventRow = await this.deps.getEventById(eventId);
    if (!eventRow) return { ok: false, code: "NOT_FOUND", message: "Event not found" };

    const targetUser = (
      await (this.db as any)
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1)
    )[0];
    if (!targetUser) return { ok: false, code: "NOT_FOUND", message: "User not found" };

    const existing = (
      await (this.db as any)
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, targetUserId)))
        .limit(1)
    )[0];
    if (existing) return { ok: false, code: "CONFLICT", message: "Participant already exists" };

    const participantId = this.deps.createId?.() ?? nanoid();
    await this.db.insert(eventParticipants).values({
      id: participantId,
      eventId,
      userId: targetUserId,
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

    if (!created) return { ok: false, code: "SERVER_ERROR", message: "Failed to add participant" };

    await this.deps.writeAuditLog({
      entityType: "event_participant",
      action: "add_by_moderator",
      actorId,
      entityId: `${eventId}:${targetUserId}`,
      detailText: JSON.stringify({ event_id: eventId, user_id: targetUserId }),
    });

    await this.deps.publishEntityChanged({
      entityType: "event",
      entityId: eventId,
      hint: "participant_added_by_moderator",
    });

    return { ok: true, participant: created };
  }

  async removeParticipant(actorId: string, eventId: string, targetUserId: string): Promise<void> {
    const existing = (
      await (this.db as any)
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, targetUserId)))
        .limit(1)
    )[0];

    await (this.db as any)
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, targetUserId)));

    if (existing) {
      await this.deps.writeAuditLog({
        entityType: "event_participant",
        action: "remove_by_moderator",
        actorId,
        entityId: `${eventId}:${targetUserId}`,
        detailText: JSON.stringify({ event_id: eventId, user_id: targetUserId }),
      });
      await this.deps.publishEntityChanged({
        entityType: "event",
        entityId: eventId,
        hint: "participant_removed_by_moderator",
      });
    }
  }

  // ── Template CRUD ──

  async createTemplate(actorId: string, data: {
    type: string;
    title: string;
    description?: string | null;
    start_at: string;
    end_at?: string | null;
    capacity?: number | null;
    recurrence_rule: unknown;
  }): Promise<EventRow> {
    this.validateDateRange(data.start_at, data.end_at);

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
      archivedAt: null,
      createdBy: actorId,
      recurrenceRule: recurrenceRuleJson,
      attachments: "[]",
      seriesId: null,
      isSeriesParent: true,
      instanceDate: null,
      lastGeneratedDate: null,
      generationCount: 0,
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

    return created;
  }

  async updateTemplate(actorId: string, templateId: string, existing: EventRow, data: {
    type?: string;
    title?: string;
    description?: string | null;
    start_at?: string;
    end_at?: string | null;
    capacity?: number | null;
    recurrence_rule?: unknown;
  }): Promise<EventRow> {
    const effectiveStartAt = data.start_at ?? existing.startAt;
    const effectiveEndAt = data.end_at !== undefined ? data.end_at : existing.endAt;
    this.validateDateRange(effectiveStartAt, effectiveEndAt);

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

    await this.db.update(events).set(patch).where(eq(events.id, templateId));

    const updated = await this.deps.getEventById(templateId);
    if (!updated) throw new Error("Failed to load updated template");

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "update",
      actorId,
      entityId: templateId,
      diffTitle: updated.title,
      detailText: JSON.stringify(data),
    });

    return updated;
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
  }

  async deleteTemplate(actorId: string, templateId: string, existing: EventRow): Promise<void> {
    await this.db.delete(events).where(eq(events.id, templateId));

    await this.deps.writeAuditLog({
      entityType: "recurring_template",
      action: "delete",
      actorId,
      entityId: templateId,
      diffTitle: existing.title,
    });
  }

  private validateDateRange(startAt: string | null | undefined, endAt: string | null | undefined) {
    if (startAt && endAt && endAt <= startAt) {
      throw new EventServiceValidationError("end_at must be after start_at");
    }
  }

  private async storeImages(eventId: string, files: File[], existingAttachmentCount: number) {
    if (files.length === 0) {
      return [];
    }

    if (existingAttachmentCount + files.length > MAX_EVENT_ATTACHMENTS) {
      throw new EventServiceValidationError(`Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
    }

    const keys: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        throw new EventServiceValidationError(`Invalid file type: ${file.name}`);
      }
      if (file.size > MAX_EVENT_IMAGE_BYTES) {
        throw new EventServiceValidationError(`File too large: ${file.name}`);
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
    archivedAt: events.archivedAt,
    createdBy: events.createdBy,
    recurrenceRule: events.recurrenceRule,
    attachments: events.attachments,
    seriesId: events.seriesId,
    isSeriesParent: events.isSeriesParent,
    instanceDate: events.instanceDate,
    lastGeneratedDate: events.lastGeneratedDate,
    generationCount: events.generationCount,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  } as const;

  private static buildEventsWhereFilters(params: {
    typeFilter?: string;
    archivedFilter?: boolean;
    startAfter?: string;
    startBefore?: string;
  }): SQL<unknown>[] {
    const filters: SQL<unknown>[] = [eq(events.isSeriesParent, false)];
    if (params.typeFilter) {
      filters.push(eq(events.type, params.typeFilter as typeof events.type.enumValues[number]));
    }
    if (params.archivedFilter === true) {
      filters.push(isNotNull(events.archivedAt));
    } else {
      filters.push(isNull(events.archivedAt));
    }
    if (params.startAfter) filters.push(gte(events.startAt, params.startAfter));
    if (params.startBefore) filters.push(lte(events.startAt, params.startBefore));
    return filters;
  }

  async getEventById(eventId: string): Promise<EventRow | null> {
    return ((await this.db.select(EventService.eventSelectFields).from(events).where(eq(events.id, eventId)).limit(1)) as EventRow[])[0] ?? null;
  }

  async listEvents(params: {
    page: number; limit: number; typeFilter?: string; archivedFilter?: boolean; startAfter?: string; startBefore?: string;
  }) {
    const offset = (params.page - 1) * params.limit;
    const whereClause = and(...EventService.buildEventsWhereFilters(params));

    const totalRow = (await this.db.select({ count: sql<number>`count(*)` }).from(events).where(whereClause).limit(1))[0] as { count: number } | undefined;
    const total = Number(totalRow?.count ?? 0);

    const rows = (await this.db
      .select(EventService.eventSelectFields)
      .from(events)
      .where(whereClause)
      .orderBy(asc(events.startAt), asc(events.id))
      .offset(offset)
      .limit(params.limit)) as EventRow[];

    return {
      data: rows.map(toEventPayload),
      total,
      page: params.page,
      limit: params.limit,
      total_pages: Math.max(1, Math.ceil(total / params.limit)),
    };
  }

  async getEventDetail(eventId: string) {
    const eventRow = await this.getEventById(eventId);
    if (!eventRow) return null;

    const participants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId))) as EventParticipantRow[];

    return { ...toEventPayload(eventRow), participants: participants.map(toParticipantPayload) };
  }

  async batchDetails(ids: string[]) {
    const eventRows = (await this.db
      .select(EventService.eventSelectFields)
      .from(events)
      .where(inArray(events.id, ids))) as EventRow[];

    const allParticipants = (await this.db
      .select({ id: eventParticipants.id, eventId: eventParticipants.eventId, userId: eventParticipants.userId, joinedAt: eventParticipants.joinedAt })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, ids))) as EventParticipantRow[];

    return eventRows.map((row) => ({
      ...toEventPayload(row),
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
}
