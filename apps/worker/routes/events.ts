import {
  ERROR_STATUS,
  createEventSchema,
  createTemplateSchema,
  eventParticipantSchema,
  eventSchema,
  hasRoleAtLeast,
  recurringTemplateSchema,
  updateEventSchema,
  updateTemplateSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, asc, eq, gte, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
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
import type { Bindings } from "../index";
import { resolveSession } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type EventRow = {
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

type EventParticipantRow = {
  id: string;
  eventId: string;
  userId: string;
  joinedAt: string;
};

export const eventsRoutes = new Hono();

const MAX_EVENT_ATTACHMENTS = 5;
const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildEventsWhereFilters(params: {
  typeFilter: string | undefined;
  archivedFilter: boolean | undefined;
  startAfter: string | undefined;
  startBefore: string | undefined;
}): SQL<unknown>[] {
  const filters: SQL<unknown>[] = [];

  // Exclude recurring templates from the regular events list
  filters.push(eq(events.isSeriesParent, false));

  if (params.typeFilter) {
    filters.push(eq(events.type, params.typeFilter as typeof events.type.enumValues[number]));
  }

  if (params.archivedFilter === true) {
    filters.push(isNotNull(events.archivedAt));
  } else {
    filters.push(isNull(events.archivedAt));
  }

  if (params.startAfter) {
    filters.push(gte(events.startAt, params.startAfter));
  }

  if (params.startBefore) {
    filters.push(lte(events.startAt, params.startBefore));
  }

  return filters;
}

function parseRecurrenceRule(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseAttachments(value: string | null | undefined): string[] {
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

function toEventPayload(row: EventRow) {
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

function toParticipantPayload(row: EventParticipantRow) {
  return eventParticipantSchema.parse({
    id: row.id,
    event_id: row.eventId,
    user_id: row.userId,
    joined_at: row.joinedAt,
  });
}

function toTemplatePayload(row: EventRow) {
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

async function getOptionalSession(c: Context): Promise<SessionUser | null> {
  const resolved = await resolveSession(c);
  return resolved?.user ?? null;
}

async function requireSession(c: Context): Promise<SessionUser | Response> {
  const sessionUser = await getOptionalSession(c);
  if (!sessionUser) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  return sessionUser;
}

function requireModerator(c: Context, user: SessionUser): Response | null {
  if (!hasRoleAtLeast(user.role, "moderator")) {
    return buildError(c, "FORBIDDEN", "Moderator role required");
  }
  return null;
}

async function getEventById(c: Context, eventId: string): Promise<EventRow | null> {
  const db = getDb(c);
  return (
    await db
      .select({
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
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
  )[0] ?? null;
}

eventsRoutes.get("/", async (c) => {
  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const typeFilter = query.type;
  const archivedFilter = parseBoolean(query.archived);
  const startAfter = query.start_after;
  const startBefore = query.start_before;

  const db = getDb(c);
  const offset = (page - 1) * limit;
  const whereFilters = buildEventsWhereFilters({
    typeFilter,
    archivedFilter,
    startAfter,
    startBefore,
  });
  const whereClause = and(...whereFilters);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(whereClause)
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
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
    })
    .from(events)
    .where(whereClause)
    .orderBy(asc(events.startAt), asc(events.id))
    .limit(limit)
    .offset(offset);

  const data = rows.map(toEventPayload);

  return c.json({
    data,
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

eventsRoutes.get("/:id", async (c) => {
  const eventId = c.req.param("id");
  const eventRow = await getEventById(c, eventId);
  if (!eventRow) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  const db = getDb(c);
  const participants = await db
    .select({
      id: eventParticipants.id,
      eventId: eventParticipants.eventId,
      userId: eventParticipants.userId,
      joinedAt: eventParticipants.joinedAt,
    })
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));

  return c.json({
    ...toEventPayload(eventRow),
    participants: participants.map(toParticipantPayload),
  });
});

eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid create event payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const eventId = nanoid();
  const attachmentsJson = JSON.stringify(parsed.data.attachments ?? []);

  await db.insert(events).values({
    id: eventId,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    startAt: parsed.data.start_at,
    endAt: parsed.data.end_at ?? null,
    capacity: parsed.data.capacity ?? null,
    pinned: false,
    signupLocked: false,
    archivedAt: null,
    createdBy: sessionUser.id,
    recurrenceRule: null,
    attachments: attachmentsJson,
    seriesId: null,
    isSeriesParent: false,
    instanceDate: null,
  });

  const created = await getEventById(c, eventId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to load created event");
  }

  await writeAuditLog(c, {
    entityType: "event",
    action: "create",
    actorId: sessionUser.id,
    entityId: eventId,
    diffTitle: created.title,
    detailText: JSON.stringify({
      type: created.type,
      start_at: created.startAt,
      end_at: created.endAt,
    }),
  });

  return c.json(toEventPayload(created), 201);
});

eventsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const existing = await getEventById(c, eventId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid update event payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const patch: Partial<typeof events.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.type !== undefined) patch.type = data.type;
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.start_at !== undefined) patch.startAt = data.start_at;
  if (data.end_at !== undefined) patch.endAt = data.end_at;
  if (data.capacity !== undefined) patch.capacity = data.capacity;
  if (data.pinned !== undefined) patch.pinned = data.pinned;
  if (data.signup_locked !== undefined) patch.signupLocked = data.signup_locked;
  if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;
  if (data.attachments !== undefined) {
    patch.attachments = JSON.stringify(data.attachments);
  }

  const db = getDb(c);
  await db.update(events).set(patch).where(eq(events.id, eventId));

  const updated = await getEventById(c, eventId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated event");
  }

  await writeAuditLog(c, {
    entityType: "event",
    action: "update",
    actorId: sessionUser.id,
    entityId: eventId,
    diffTitle: updated.title,
    detailText: JSON.stringify(data),
  });

  return c.json(toEventPayload(updated));
});

eventsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const existing = await getEventById(c, eventId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  const db = getDb(c);
  await db
    .update(events)
    .set({
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(events.id, eventId));

  await writeAuditLog(c, {
    entityType: "event",
    action: "archive",
    actorId: sessionUser.id,
    entityId: eventId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});

eventsRoutes.delete("/:id/destroy", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const existing = await getEventById(c, eventId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  const db = getDb(c);

  // Clear or detach dependent rows that reference this event.
  await db.delete(botDiscordEventMessages).where(eq(botDiscordEventMessages.eventId, eventId));
  await db.delete(botWechatEventMessages).where(eq(botWechatEventMessages.eventId, eventId));
  await db.delete(botDeliveryLog).where(eq(botDeliveryLog.eventId, eventId));
  await db.update(warTemplates).set({ sourceEventId: null }).where(eq(warTemplates.sourceEventId, eventId));
  await db
    .update(warHistory)
    .set({
      eventId: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(warHistory.eventId, eventId));

  // Remove all participants first
  await db.delete(eventParticipants).where(eq(eventParticipants.eventId, eventId));

  // Hard delete the event
  await db.delete(events).where(eq(events.id, eventId));

  await writeAuditLog(c, {
    entityType: "event",
    action: "delete",
    actorId: sessionUser.id,
    entityId: eventId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});

eventsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const existing = await getEventById(c, eventId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  const form = await c.req.formData();
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) {
    files.push(single);
  }
  for (const item of form.getAll("files")) {
    if (item instanceof File) {
      files.push(item);
    }
  }

  if (files.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "No files provided");
  }

  const existingAttachments = parseAttachments(existing.attachments);
  if (existingAttachments.length + files.length > MAX_EVENT_ATTACHMENTS) {
    return buildError(c, "VALIDATION_ERROR", `Max ${MAX_EVENT_ATTACHMENTS} attachments per event`);
  }

  const env = c.env as Bindings;
  const keys: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return buildError(c, "VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    }
    if (file.size > MAX_EVENT_IMAGE_BYTES) {
      return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
    }
    const key = `events/${eventId}/images/${Date.now()}_${nanoid()}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    keys.push(key);
  }

  const attachments = [...existingAttachments, ...keys].slice(0, MAX_EVENT_ATTACHMENTS);
  const db = getDb(c);
  await db
    .update(events)
    .set({
      attachments: JSON.stringify(attachments),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(events.id, eventId));

  await writeAuditLog(c, {
    entityType: "event",
    action: "upload_images",
    actorId: sessionUser.id,
    entityId: eventId,
    diffTitle: existing.title,
    detailText: JSON.stringify({ keys }),
  });

  return c.json({ keys, attachments });
});

eventsRoutes.post("/:id/join", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const eventId = c.req.param("id");
  const participantId = nanoid();
  const env = c.env as Bindings;
  const insertResult = await env.DB.prepare(
    `
      INSERT INTO event_participants (id, event_id, user_id)
      SELECT ?1, ?2, ?3
      WHERE EXISTS (
        SELECT 1
        FROM events e
        WHERE e.id = ?2
          AND e.archived_at IS NULL
          AND e.signup_locked = 0
          AND (
            e.capacity IS NULL
            OR (SELECT COUNT(*) FROM event_participants ep WHERE ep.event_id = e.id) < e.capacity
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM event_participants p
        WHERE p.event_id = ?2 AND p.user_id = ?3
      )
    `,
  )
    .bind(participantId, eventId, sessionUser.id)
    .run();

  if ((insertResult.meta?.changes ?? 0) !== 1) {
    const db = getDb(c);
    const eventRow = await getEventById(c, eventId);
    if (!eventRow) {
      return buildError(c, "NOT_FOUND", "Event not found");
    }
    if (eventRow.archivedAt !== null) {
      return buildError(c, "CONFLICT", "Event is archived");
    }
    if (eventRow.signupLocked) {
      return buildError(c, "CONFLICT", "Event signup is locked");
    }

    const existing = (
      await db
        .select({ id: eventParticipants.id })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, sessionUser.id)))
        .limit(1)
    )[0];
    if (existing) {
      return buildError(c, "CONFLICT", "Already joined");
    }

    if (eventRow.capacity !== null) {
      const countRow = (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(eventParticipants)
          .where(eq(eventParticipants.eventId, eventId))
      )[0];
      const count = Number(countRow?.count ?? 0);
      if (count >= eventRow.capacity) {
        return buildError(c, "CONFLICT", "Event is full");
      }
    }

    return buildError(c, "SERVER_ERROR", "Failed to join event");
  }

  const db = getDb(c);
  await writeAuditLog(c, {
    entityType: "event_participant",
    action: "join",
    actorId: sessionUser.id,
    entityId: `${eventId}:${sessionUser.id}`,
    detailText: JSON.stringify({ event_id: eventId, user_id: sessionUser.id }),
  });

  const created = (
    await db
      .select({
        id: eventParticipants.id,
        eventId: eventParticipants.eventId,
        userId: eventParticipants.userId,
        joinedAt: eventParticipants.joinedAt,
      })
      .from(eventParticipants)
      .where(eq(eventParticipants.id, participantId))
      .limit(1)
  )[0];

  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create participant");
  }

  await publishEntityChanged(c.env as Bindings, {
    entityType: "event",
    entityId: eventId,
    hint: "participant_joined",
  });

  return c.json(toParticipantPayload(created), 201);
});

eventsRoutes.delete("/:id/leave", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const eventId = c.req.param("id");
  const db = getDb(c);
  const existing = (
    await db
      .select({ id: eventParticipants.id })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, sessionUser.id)))
      .limit(1)
  )[0];

  await db
    .delete(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, sessionUser.id)));

  if (existing) {
    await writeAuditLog(c, {
      entityType: "event_participant",
      action: "leave",
      actorId: sessionUser.id,
      entityId: `${eventId}:${sessionUser.id}`,
      detailText: JSON.stringify({ event_id: eventId, user_id: sessionUser.id }),
    });

    await publishEntityChanged(c.env as Bindings, {
      entityType: "event",
      entityId: eventId,
      hint: "participant_left",
    });
  }
  return c.json({ ok: true });
});

eventsRoutes.post("/:id/participants", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const eventRow = await getEventById(c, eventId);
  if (!eventRow) {
    return buildError(c, "NOT_FOUND", "Event not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
  const payload = body as { user_id?: unknown };
  if (typeof payload.user_id !== "string" || payload.user_id.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "user_id is required");
  }

  const db = getDb(c);
  const targetUser = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, payload.user_id))
      .limit(1)
  )[0];
  if (!targetUser) {
    return buildError(c, "NOT_FOUND", "User not found");
  }

  const existing = (
    await db
      .select({ id: eventParticipants.id })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, payload.user_id)))
      .limit(1)
  )[0];
  if (existing) {
    return buildError(c, "CONFLICT", "Participant already exists");
  }

  const participantId = nanoid();
  await db.insert(eventParticipants).values({
    id: participantId,
    eventId,
    userId: payload.user_id,
  });

  const created = (
    await db
      .select({
        id: eventParticipants.id,
        eventId: eventParticipants.eventId,
        userId: eventParticipants.userId,
        joinedAt: eventParticipants.joinedAt,
      })
      .from(eventParticipants)
      .where(eq(eventParticipants.id, participantId))
      .limit(1)
  )[0];
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to add participant");
  }

  await writeAuditLog(c, {
    entityType: "event_participant",
    action: "add_by_moderator",
    actorId: sessionUser.id,
    entityId: `${eventId}:${payload.user_id}`,
    detailText: JSON.stringify({ event_id: eventId, user_id: payload.user_id }),
  });

  await publishEntityChanged(c.env as Bindings, {
    entityType: "event",
    entityId: eventId,
    hint: "participant_added_by_moderator",
  });

  return c.json(toParticipantPayload(created), 201);
});

eventsRoutes.delete("/:id/participants/:userId", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const eventId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const db = getDb(c);
  const existing = (
    await db
      .select({ id: eventParticipants.id })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, targetUserId)))
      .limit(1)
  )[0];

  await db
    .delete(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, targetUserId)));

  if (existing) {
    await writeAuditLog(c, {
      entityType: "event_participant",
      action: "remove_by_moderator",
      actorId: sessionUser.id,
      entityId: `${eventId}:${targetUserId}`,
      detailText: JSON.stringify({ event_id: eventId, user_id: targetUserId }),
    });

    await publishEntityChanged(c.env as Bindings, {
      entityType: "event",
      entityId: eventId,
      hint: "participant_removed_by_moderator",
    });
  }
  return c.json({ ok: true });
});

// ── Recurring Templates ──

const templateSelectFields = {
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

eventsRoutes.get("/templates/list", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const db = getDb(c);
  const rows = await db
    .select(templateSelectFields)
    .from(events)
    .where(eq(events.isSeriesParent, true))
    .orderBy(asc(events.createdAt), asc(events.id));

  return c.json({ data: rows.map(toTemplatePayload) });
});

eventsRoutes.post("/templates", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid template payload", parsed.error.flatten());
  }

  const db = getDb(c);
  const templateId = nanoid();
  const recurrenceRuleJson = JSON.stringify(parsed.data.recurrence_rule);

  await db.insert(events).values({
    id: templateId,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    startAt: parsed.data.start_at,
    endAt: parsed.data.end_at ?? null,
    capacity: parsed.data.capacity ?? null,
    pinned: false,
    signupLocked: false,
    archivedAt: null,
    createdBy: sessionUser.id,
    recurrenceRule: recurrenceRuleJson,
    attachments: "[]",
    seriesId: null,
    isSeriesParent: true,
    instanceDate: null,
    lastGeneratedDate: null,
    generationCount: 0,
  });

  const created = await getEventById(c, templateId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to load created template");
  }

  await writeAuditLog(c, {
    entityType: "recurring_template",
    action: "create",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: created.title,
    detailText: JSON.stringify({ recurrence_rule: parsed.data.recurrence_rule }),
  });

  return c.json(toTemplatePayload(created), 201);
});

eventsRoutes.patch("/templates/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const templateId = c.req.param("id");
  const existing = await getEventById(c, templateId);
  if (!existing || !existing.isSeriesParent) {
    return buildError(c, "NOT_FOUND", "Template not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid template update payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const patch: Partial<typeof events.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.type !== undefined) patch.type = data.type;
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.start_at !== undefined) patch.startAt = data.start_at;
  if (data.end_at !== undefined) patch.endAt = data.end_at;
  if (data.capacity !== undefined) patch.capacity = data.capacity;
  if (data.recurrence_rule !== undefined) {
    patch.recurrenceRule = JSON.stringify(data.recurrence_rule);
  }

  const db = getDb(c);
  await db.update(events).set(patch).where(eq(events.id, templateId));

  const updated = await getEventById(c, templateId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated template");
  }

  await writeAuditLog(c, {
    entityType: "recurring_template",
    action: "update",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: updated.title,
    detailText: JSON.stringify(data),
  });

  return c.json(toTemplatePayload(updated));
});

eventsRoutes.post("/templates/:id/pause", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const templateId = c.req.param("id");
  const existing = await getEventById(c, templateId);
  if (!existing || !existing.isSeriesParent) {
    return buildError(c, "NOT_FOUND", "Template not found");
  }

  const db = getDb(c);
  const now = new Date().toISOString();
  await db
    .update(events)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(events.id, templateId));

  await writeAuditLog(c, {
    entityType: "recurring_template",
    action: "pause",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});

eventsRoutes.post("/templates/:id/resume", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const templateId = c.req.param("id");
  const existing = await getEventById(c, templateId);
  if (!existing || !existing.isSeriesParent) {
    return buildError(c, "NOT_FOUND", "Template not found");
  }

  const db = getDb(c);
  const now = new Date().toISOString();
  await db
    .update(events)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(events.id, templateId));

  await writeAuditLog(c, {
    entityType: "recurring_template",
    action: "resume",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});

eventsRoutes.delete("/templates/:id", async (c) => {
  const sessionUser = await requireSession(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const roleError = requireModerator(c, sessionUser);
  if (roleError) {
    return roleError;
  }

  const templateId = c.req.param("id");
  const existing = await getEventById(c, templateId);
  if (!existing || !existing.isSeriesParent) {
    return buildError(c, "NOT_FOUND", "Template not found");
  }

  const db = getDb(c);
  await db.delete(events).where(eq(events.id, templateId));

  await writeAuditLog(c, {
    entityType: "recurring_template",
    action: "delete",
    actorId: sessionUser.id,
    entityId: templateId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});
