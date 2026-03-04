import { and, eq, isNull, not, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { events } from "../db/schema";
import type { Bindings } from "../index";

type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  endAfter?: number;
  endDate?: string;
};

const LOOKAHEAD_DAYS = 56;
const MAX_CREATED_PER_SERIES = 5;

function parseRecurrenceRule(value: string | null): RecurrenceRule | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const rule = parsed as Record<string, unknown>;
    const frequency = rule.frequency;
    const interval = rule.interval;

    if (
      (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") ||
      typeof interval !== "number" ||
      !Number.isFinite(interval) ||
      interval <= 0
    ) {
      return null;
    }

    const endAfter = typeof rule.endAfter === "number" && Number.isFinite(rule.endAfter)
      ? Math.max(1, Math.floor(rule.endAfter))
      : undefined;
    const endDate = typeof rule.endDate === "string" ? rule.endDate : undefined;

    return {
      frequency,
      interval: Math.floor(interval),
      endAfter,
      endDate,
    };
  } catch {
    return null;
  }
}

function addInterval(date: Date, rule: RecurrenceRule): Date {
  const next = new Date(date);
  if (rule.frequency === "daily") {
    next.setUTCDate(next.getUTCDate() + rule.interval);
    return next;
  }

  if (rule.frequency === "weekly") {
    next.setUTCDate(next.getUTCDate() + rule.interval * 7);
    return next;
  }

  next.setUTCMonth(next.getUTCMonth() + rule.interval);
  return next;
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function computeEndAt(startAtIso: string, endAtIso: string | null, nextStartAtIso: string): string | null {
  if (!endAtIso) {
    return null;
  }

  const startMs = Date.parse(startAtIso);
  const endMs = Date.parse(endAtIso);
  const nextStartMs = Date.parse(nextStartAtIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(nextStartMs) || endMs <= startMs) {
    return null;
  }

  return new Date(nextStartMs + (endMs - startMs)).toISOString();
}

export async function runEventInstanceGenerationCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + LOOKAHEAD_DAYS);

  const recurringRows = await db
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
      createdBy: events.createdBy,
      recurrenceRule: events.recurrenceRule,
      attachments: events.attachments,
      isSeriesParent: events.isSeriesParent,
      seriesId: events.seriesId,
    })
    .from(events)
    .where(
      and(
        isNull(events.archivedAt),
        not(isNull(events.recurrenceRule)),
        or(eq(events.isSeriesParent, true), isNull(events.seriesId)),
      ),
    );

  for (const row of recurringRows) {
    const rule = parseRecurrenceRule(row.recurrenceRule);
    if (!rule) {
      continue;
    }

    const baseStart = new Date(row.startAt);
    if (!isValidDate(baseStart)) {
      continue;
    }

    const seriesId = row.id;
    const lastRow = await env.DB.prepare(
      "SELECT MAX(start_at) AS last_start FROM events WHERE (id = ?1 OR series_id = ?1) AND archived_at IS NULL",
    )
      .bind(seriesId)
      .first<{ last_start?: string | null }>();

    let anchor = baseStart;
    if (typeof lastRow?.last_start === "string") {
      const parsed = new Date(lastRow.last_start);
      if (isValidDate(parsed)) {
        anchor = parsed;
      }
    }

    let generated = 0;
    while (generated < MAX_CREATED_PER_SERIES) {
      const nextStart = addInterval(anchor, rule);
      if (!isValidDate(nextStart)) {
        break;
      }

      if (nextStart > horizon) {
        break;
      }

      if (rule.endDate) {
        const endDate = new Date(rule.endDate);
        if (isValidDate(endDate) && nextStart > endDate) {
          break;
        }
      }

      if (rule.endAfter) {
        const countRow = await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM events WHERE (id = ?1 OR series_id = ?1)",
        )
          .bind(seriesId)
          .first<{ total?: number | string }>();
        const total = Number(countRow?.total ?? 0);
        if (total >= rule.endAfter) {
          break;
        }
      }

      const instanceDate = toDateKey(nextStart);
      const existing = await env.DB.prepare(
        "SELECT id FROM events WHERE series_id = ?1 AND instance_date = ?2 LIMIT 1",
      )
        .bind(seriesId, instanceDate)
        .first<{ id?: string }>();

      if (existing?.id) {
        anchor = nextStart;
        continue;
      }

      const nextStartIso = nextStart.toISOString();
      await db.insert(events).values({
        id: nanoid(),
        type: row.type,
        title: row.title,
        description: row.description,
        startAt: nextStartIso,
        endAt: computeEndAt(row.startAt, row.endAt, nextStartIso),
        capacity: row.capacity,
        pinned: row.pinned,
        signupLocked: row.signupLocked,
        archivedAt: null,
        createdBy: row.createdBy,
        recurrenceRule: null,
        attachments: row.attachments,
        seriesId,
        isSeriesParent: false,
        instanceDate,
        updatedAt: new Date().toISOString(),
      });

      generated += 1;
      anchor = nextStart;
    }
  }
}
