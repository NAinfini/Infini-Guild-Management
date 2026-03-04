import {
  ERROR_STATUS,
  createEventSchema,
  eventParticipantSchema,
  eventSchema,
  hasRoleAtLeast,
  updateEventSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eventParticipants, events, users } from "../db/schema";
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
  createdAt: string;
  updatedAt: string;
};

type EventParticipantRow = {
  id: string;
  eventId: string;
  userId: string;
  joinedAt: string;
};

type RecurrenceRuleInput = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];
  endAfter?: number;
  endDate?: string;
};

type RecurrenceScope = "this" | "future" | "all";

type RecurrenceOccurrence = {
  startAt: string;
  endAt: string | null;
  instanceDate: string;
};

export const eventsRoutes = new Hono();

const RECURRENCE_GENERATION_DAYS = 56;
const SERIES_EXCEPTION_LIMIT = 50;
const MAX_EVENT_ATTACHMENTS = 5;
const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function addDaysUtc(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

function addMonthsUtc(base: Date, months: number): Date {
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function withUtcTime(sourceDate: Date, timeSource: Date): Date {
  const next = new Date(
    Date.UTC(
      sourceDate.getUTCFullYear(),
      sourceDate.getUTCMonth(),
      sourceDate.getUTCDate(),
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      timeSource.getUTCMilliseconds(),
    ),
  );
  return next;
}

function toInstanceDate(iso: string): string {
  return iso.slice(0, 10);
}

function resolveDurationMs(startAt: Date, endAt: Date | null): number | null {
  if (!endAt) {
    return null;
  }
  const duration = endAt.getTime() - startAt.getTime();
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return duration;
}

function shiftIsoByMs(iso: string, deltaMs: number): string | null {
  const parsed = parseIsoDate(iso);
  if (!parsed || !Number.isFinite(deltaMs)) {
    return null;
  }
  return new Date(parsed.getTime() + deltaMs).toISOString();
}

function normalizeWeeklyDays(rule: RecurrenceRuleInput, startAt: Date): number[] {
  const source = Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0
    ? rule.daysOfWeek
    : [startAt.getUTCDay()];
  const normalized = Array.from(
    new Set(
      source
        .map((value) => Math.trunc(value))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6),
    ),
  ).sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : [startAt.getUTCDay()];
}

function buildRecurrenceOccurrences(
  startAtIso: string,
  endAtIso: string | null,
  rule: RecurrenceRuleInput,
): RecurrenceOccurrence[] {
  const startAt = parseIsoDate(startAtIso);
  if (!startAt) {
    return [];
  }
  const endAt = endAtIso ? parseIsoDate(endAtIso) : null;
  const durationMs = resolveDurationMs(startAt, endAt);
  const maxOccurrences = Math.max(1, Math.trunc(rule.endAfter ?? Number.MAX_SAFE_INTEGER));
  const explicitEnd = typeof rule.endDate === "string" ? parseIsoDate(rule.endDate) : null;
  const horizonEndMs = Math.min(
    startAt.getTime() + RECURRENCE_GENERATION_DAYS * DAY_MS,
    explicitEnd ? explicitEnd.getTime() : Number.MAX_SAFE_INTEGER,
  );

  const buildOccurrence = (candidateStart: Date): RecurrenceOccurrence | null => {
    const startMs = candidateStart.getTime();
    if (!Number.isFinite(startMs) || startMs > horizonEndMs) {
      return null;
    }
    const nextStart = candidateStart.toISOString();
    const nextEnd = durationMs !== null ? new Date(startMs + durationMs).toISOString() : null;
    return {
      startAt: nextStart,
      endAt: nextEnd,
      instanceDate: toInstanceDate(nextStart),
    };
  };

  const occurrences: RecurrenceOccurrence[] = [];
  const first = buildOccurrence(startAt);
  if (!first) {
    return [];
  }
  occurrences.push(first);

  const interval = Math.max(1, Math.trunc(rule.interval));

  if (rule.frequency === "daily") {
    let step = 1;
    while (occurrences.length < maxOccurrences) {
      const candidate = addDaysUtc(startAt, step * interval);
      const occurrence = buildOccurrence(candidate);
      if (!occurrence) {
        break;
      }
      occurrences.push(occurrence);
      step += 1;
    }
  } else if (rule.frequency === "weekly") {
    const weeklyDays = normalizeWeeklyDays(rule, startAt);
    const startDay = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate()));
    for (let offset = 1; occurrences.length < maxOccurrences; offset += 1) {
      const candidateDay = addDaysUtc(startDay, offset);
      const weeksFromStart = Math.floor((candidateDay.getTime() - startDay.getTime()) / (7 * DAY_MS));
      if (weeksFromStart % interval !== 0) {
        continue;
      }
      if (!weeklyDays.includes(candidateDay.getUTCDay())) {
        continue;
      }
      const candidate = withUtcTime(candidateDay, startAt);
      if (candidate.getTime() <= startAt.getTime()) {
        continue;
      }
      const occurrence = buildOccurrence(candidate);
      if (!occurrence) {
        break;
      }
      occurrences.push(occurrence);
    }
  } else {
    let step = 1;
    while (occurrences.length < maxOccurrences) {
      const candidate = addMonthsUtc(startAt, step * interval);
      const occurrence = buildOccurrence(candidate);
      if (!occurrence) {
        break;
      }
      occurrences.push(occurrence);
      step += 1;
    }
  }

  const deduped = Array.from(new Map(occurrences.map((item) => [item.startAt, item])).values());
  deduped.sort((left, right) => left.startAt.localeCompare(right.startAt));
  return deduped.slice(0, maxOccurrences);
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
  const recurrenceRule = parsed.data.recurrence_rule as RecurrenceRuleInput | undefined;
  const recurrenceRuleJson = recurrenceRule ? JSON.stringify(recurrenceRule) : null;
  const recurrenceSeriesId = recurrenceRule ? eventId : null;
  const attachmentsJson = JSON.stringify(parsed.data.attachments ?? []);
  const occurrences = recurrenceRule
    ? buildRecurrenceOccurrences(parsed.data.start_at, parsed.data.end_at ?? null, recurrenceRule)
    : [];
  const normalizedOccurrences =
    occurrences.length > 0
      ? occurrences
      : [
          {
            startAt: parsed.data.start_at,
            endAt: parsed.data.end_at ?? null,
            instanceDate: toInstanceDate(parsed.data.start_at),
          },
        ];

  const rowsToInsert = normalizedOccurrences.map((occurrence, index) => ({
    id: index === 0 ? eventId : nanoid(),
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    capacity: parsed.data.capacity ?? null,
    pinned: false,
    signupLocked: false,
    archivedAt: null,
    createdBy: sessionUser.id,
    recurrenceRule: recurrenceRuleJson,
    attachments: attachmentsJson,
    seriesId: recurrenceSeriesId,
    isSeriesParent: recurrenceRule ? index === 0 : false,
    instanceDate: recurrenceRule ? occurrence.instanceDate : null,
  }));

  // D1 has a 100-variable limit; chunk large recurring inserts
  for (let i = 0; i < rowsToInsert.length; i += 5) {
    await db.insert(events).values(rowsToInsert.slice(i, i + 5));
  }

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
      generated_instances: rowsToInsert.length,
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
  const recurrenceScope = (data.recurrence_scope ?? "this") as RecurrenceScope;
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
  if (data.recurrence_rule !== undefined) {
    patch.recurrenceRule = data.recurrence_rule ? JSON.stringify(data.recurrence_rule) : null;
  }
  if (data.attachments !== undefined) {
    patch.attachments = JSON.stringify(data.attachments);
  }

  const db = getDb(c);
  const hasSeries = typeof existing.seriesId === "string" && existing.seriesId.length > 0;
  if (hasSeries && recurrenceScope === "this") {
    // Instance-only edits should not rewrite shared series recurrence metadata.
    delete patch.recurrenceRule;
    const shouldDetachInstance =
      data.type !== undefined ||
      data.title !== undefined ||
      data.description !== undefined ||
      data.capacity !== undefined ||
      data.start_at !== undefined ||
      data.end_at !== undefined;
    if (shouldDetachInstance) {
      const detachedCountRow = (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(events)
          .where(
            and(
              eq(events.seriesId, existing.seriesId as string),
              eq(events.isSeriesParent, false),
              isNull(events.instanceDate),
            ),
          )
      )[0];
      const detachedCount = Number(detachedCountRow?.count ?? 0);
      if (detachedCount >= SERIES_EXCEPTION_LIMIT) {
        return buildError(c, "VALIDATION_ERROR", "Series exception limit reached");
      }
      patch.seriesId = existing.seriesId as string;
      patch.recurrenceRule = null;
      patch.isSeriesParent = false;
      patch.instanceDate = null;
    }
  }
  if (hasSeries && patch.startAt !== undefined) {
    patch.instanceDate = toInstanceDate(patch.startAt);
  }
  const shouldPropagate = hasSeries && recurrenceScope !== "this";

  if (shouldPropagate) {
    const seriesWhereClause =
      recurrenceScope === "future"
        ? and(
            eq(events.seriesId, existing.seriesId as string),
            gte(events.startAt, existing.startAt),
            isNotNull(events.instanceDate),
          )
        : and(eq(events.seriesId, existing.seriesId as string), isNotNull(events.instanceDate));
    const scopeRows = await db
      .select({
        id: events.id,
        startAt: events.startAt,
        endAt: events.endAt,
      })
      .from(events)
      .where(seriesWhereClause)
      .orderBy(asc(events.startAt), asc(events.id));

    const sharedPatch: Partial<typeof events.$inferInsert> = { ...patch };
    delete sharedPatch.startAt;
    delete sharedPatch.endAt;
    delete sharedPatch.instanceDate;
    if (Object.keys(sharedPatch).length > 0 && scopeRows.length > 0) {
      await db.update(events).set(sharedPatch).where(seriesWhereClause);
    }

    if (data.recurrence_rule !== undefined && scopeRows.length > 0) {
      const scopeAnchorRow = scopeRows[0] ?? null;
      const existingStart = parseIsoDate(existing.startAt);
      const requestedStart = data.start_at ? parseIsoDate(data.start_at) : null;
      let anchorStartAt = data.start_at ?? existing.startAt;

      if (recurrenceScope === "all" && scopeAnchorRow) {
        if (requestedStart && existingStart) {
          const startDeltaMs = requestedStart.getTime() - existingStart.getTime();
          anchorStartAt = shiftIsoByMs(scopeAnchorRow.startAt, startDeltaMs) ?? scopeAnchorRow.startAt;
        } else {
          anchorStartAt = scopeAnchorRow.startAt;
        }
      }

      const anchorStartDate = parseIsoDate(anchorStartAt);
      let anchorEndAt: string | null = null;
      if (data.end_at !== undefined) {
        if (data.end_at === null) {
          anchorEndAt = null;
        } else if (anchorStartDate) {
          const requestedEnd = parseIsoDate(data.end_at);
          const durationSourceStart = requestedStart ?? existingStart;
          const durationMs =
            durationSourceStart && requestedEnd ? resolveDurationMs(durationSourceStart, requestedEnd) : null;
          anchorEndAt =
            durationMs !== null ? new Date(anchorStartDate.getTime() + durationMs).toISOString() : null;
        }
      } else if (anchorStartDate) {
        const existingEnd = parseIsoDate(existing.endAt ?? "");
        const durationMs = existingStart && existingEnd ? resolveDurationMs(existingStart, existingEnd) : null;
        anchorEndAt =
          durationMs !== null ? new Date(anchorStartDate.getTime() + durationMs).toISOString() : null;
      }

      const generatedOccurrences = buildRecurrenceOccurrences(anchorStartAt, anchorEndAt, data.recurrence_rule);
      const normalizedOccurrences =
        generatedOccurrences.length > 0
          ? generatedOccurrences
          : [
              {
                startAt: anchorStartAt,
                endAt: anchorEndAt,
                instanceDate: toInstanceDate(anchorStartAt),
              },
            ];

      const rowsToUpdate = scopeRows.slice(0, normalizedOccurrences.length);
      for (let index = 0; index < rowsToUpdate.length; index += 1) {
        const row = rowsToUpdate[index];
        const occurrence = normalizedOccurrences[index];
        if (!occurrence) {
          continue;
        }
        await db
          .update(events)
          .set({
            startAt: occurrence.startAt,
            endAt: occurrence.endAt,
            instanceDate: occurrence.instanceDate,
            updatedAt: patch.updatedAt,
          })
          .where(eq(events.id, row.id));
      }

      if (normalizedOccurrences.length > scopeRows.length) {
        const rowsToInsert = normalizedOccurrences.slice(scopeRows.length).map((occurrence) => ({
          id: nanoid(),
          type: (patch.type ?? existing.type) as typeof events.type.enumValues[number],
          title: patch.title ?? existing.title,
          description: patch.description ?? existing.description,
          startAt: occurrence.startAt,
          endAt: occurrence.endAt,
          capacity: patch.capacity ?? existing.capacity,
          pinned: patch.pinned ?? existing.pinned,
          signupLocked: patch.signupLocked ?? existing.signupLocked,
          archivedAt: patch.archivedAt ?? null,
          createdBy: existing.createdBy,
          recurrenceRule: patch.recurrenceRule ?? existing.recurrenceRule,
          attachments: patch.attachments ?? existing.attachments,
          seriesId: existing.seriesId,
          isSeriesParent: false,
          instanceDate: occurrence.instanceDate,
          updatedAt: patch.updatedAt,
        }));
        // D1 has a 100-variable limit; chunk large recurring inserts
        for (let i = 0; i < rowsToInsert.length; i += 5) {
          await db.insert(events).values(rowsToInsert.slice(i, i + 5));
        }
      }

      if (recurrenceScope === "all" && scopeRows.length > 0) {
        await db
          .update(events)
          .set({
            isSeriesParent: false,
            updatedAt: patch.updatedAt,
          })
          .where(and(eq(events.seriesId, existing.seriesId as string), isNotNull(events.instanceDate)));
        const parentRow = rowsToUpdate[0];
        if (parentRow) {
          await db
            .update(events)
            .set({
              isSeriesParent: true,
              updatedAt: patch.updatedAt,
            })
            .where(eq(events.id, parentRow.id));
        }
      }

      if (normalizedOccurrences.length < scopeRows.length) {
        const obsoleteRows = scopeRows.slice(normalizedOccurrences.length);
        const obsoleteEventIds = obsoleteRows.map((row) => row.id);
        if (obsoleteEventIds.length > 0) {
          const participantCounts = await db
            .select({
              eventId: eventParticipants.eventId,
              count: sql<number>`count(*)`,
            })
            .from(eventParticipants)
            .where(inArray(eventParticipants.eventId, obsoleteEventIds))
            .groupBy(eventParticipants.eventId);
          const countByEventId = new Map(
            participantCounts.map((row) => [row.eventId, Number(row.count ?? 0)]),
          );

          const detachIds = obsoleteRows
            .filter((row) => (countByEventId.get(row.id) ?? 0) > 0)
            .map((row) => row.id);
          if (detachIds.length > 0) {
            await db
              .update(events)
              .set({
                seriesId: existing.seriesId as string,
                recurrenceRule: null,
                isSeriesParent: false,
                instanceDate: null,
                updatedAt: patch.updatedAt,
              })
              .where(inArray(events.id, detachIds));
          }

          const archiveIds = obsoleteRows
            .filter((row) => (countByEventId.get(row.id) ?? 0) === 0)
            .map((row) => row.id);
          if (archiveIds.length > 0) {
            await db
              .update(events)
              .set({
                archivedAt: patch.updatedAt,
                updatedAt: patch.updatedAt,
              })
              .where(inArray(events.id, archiveIds));
          }
        }
      }
    } else if ((patch.startAt !== undefined || patch.endAt !== undefined) && scopeRows.length > 0) {
      const existingStart = parseIsoDate(existing.startAt);
      const nextBaseStart = parseIsoDate(data.start_at ?? existing.startAt);
      const startDeltaMs =
        patch.startAt !== undefined && existingStart && nextBaseStart
          ? nextBaseStart.getTime() - existingStart.getTime()
          : 0;
      const explicitDurationMs =
        patch.endAt !== undefined && nextBaseStart
          ? resolveDurationMs(nextBaseStart, parseIsoDate(data.end_at ?? "") ?? null)
          : null;

      for (const row of scopeRows) {
        let nextStartAt = row.startAt;
        if (patch.startAt !== undefined) {
          const shiftedStart = shiftIsoByMs(row.startAt, startDeltaMs);
          if (shiftedStart) {
            nextStartAt = shiftedStart;
          }
        }

        let nextEndAt = row.endAt;
        if (patch.endAt !== undefined) {
          if (explicitDurationMs === null) {
            nextEndAt = null;
          } else {
            const shiftedStart = parseIsoDate(nextStartAt);
            nextEndAt = shiftedStart ? new Date(shiftedStart.getTime() + explicitDurationMs).toISOString() : row.endAt;
          }
        } else if (patch.startAt !== undefined && row.endAt) {
          const shiftedEnd = shiftIsoByMs(row.endAt, startDeltaMs);
          if (shiftedEnd) {
            nextEndAt = shiftedEnd;
          }
        }

        await db
          .update(events)
          .set({
            startAt: nextStartAt,
            endAt: nextEndAt,
            instanceDate: toInstanceDate(nextStartAt),
            updatedAt: patch.updatedAt,
          })
          .where(eq(events.id, row.id));
      }
    }
  } else {
    await db.update(events).set(patch).where(eq(events.id, eventId));
  }

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
    detailText: JSON.stringify({
      ...data,
      recurrence_scope: recurrenceScope,
    }),
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
