import { and, eq, isNull, not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { events } from "../db/schema";
import type { Bindings } from "../index";

type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endAfter?: number;
  endDate?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

    const daysOfWeek = Array.isArray(rule.daysOfWeek)
      ? (rule.daysOfWeek as unknown[])
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v >= 0 && v <= 6)
      : undefined;
    const dayOfMonth =
      typeof rule.dayOfMonth === "number" && Number.isFinite(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31
        ? Math.floor(rule.dayOfMonth)
        : undefined;
    const endAfter =
      typeof rule.endAfter === "number" && Number.isFinite(rule.endAfter)
        ? Math.max(1, Math.floor(rule.endAfter))
        : undefined;
    const endDate = typeof rule.endDate === "string" ? rule.endDate : undefined;

    return {
      frequency,
      interval: Math.floor(interval),
      daysOfWeek: daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : undefined,
      dayOfMonth,
      endAfter,
      endDate,
    };
  } catch {
    return null;
  }
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
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

/**
 * Compute the next occurrence date after `anchor` according to the recurrence rule.
 * Uses the template's `startAt` for time-of-day reference.
 */
function computeNextOccurrence(anchor: Date, templateStart: Date, rule: RecurrenceRule): Date | null {
  if (rule.frequency === "daily") {
    const next = new Date(anchor);
    next.setUTCDate(next.getUTCDate() + rule.interval);
    // Preserve time-of-day from template
    next.setUTCHours(templateStart.getUTCHours(), templateStart.getUTCMinutes(), templateStart.getUTCSeconds(), 0);
    return isValidDate(next) ? next : null;
  }

  if (rule.frequency === "weekly") {
    const days = rule.daysOfWeek && rule.daysOfWeek.length > 0
      ? [...rule.daysOfWeek].sort((a, b) => a - b)
      : [templateStart.getUTCDay()];

    // Start from the day after anchor and scan forward
    const cursor = new Date(anchor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(templateStart.getUTCHours(), templateStart.getUTCMinutes(), templateStart.getUTCSeconds(), 0);

    // Scan up to interval * 7 + 7 days to find the next matching weekday
    const maxScan = rule.interval * 7 + 7;
    for (let i = 0; i < maxScan; i++) {
      const candidateDay = cursor.getUTCDay();
      if (days.includes(candidateDay)) {
        // Check we're in a valid week (respecting interval)
        const templateDay = new Date(Date.UTC(templateStart.getUTCFullYear(), templateStart.getUTCMonth(), templateStart.getUTCDate()));
        const cursorDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
        const daysDiff = Math.round((cursorDay.getTime() - templateDay.getTime()) / DAY_MS);
        const weeksDiff = Math.floor(daysDiff / 7);
        if (weeksDiff >= 0 && weeksDiff % rule.interval === 0) {
          return cursor;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return null;
  }

  // Monthly
  const next = new Date(anchor);
  next.setUTCMonth(next.getUTCMonth() + rule.interval);
  if (rule.dayOfMonth) {
    // Set to the target day, clamping to month's last day
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(rule.dayOfMonth, lastDay));
  }
  next.setUTCHours(templateStart.getUTCHours(), templateStart.getUTCMinutes(), templateStart.getUTCSeconds(), 0);
  return isValidDate(next) ? next : null;
}

/**
 * Compute the lookahead horizon based on frequency.
 * - daily: 1 day ahead
 * - weekly: 7 days ahead
 * - monthly: ~31 days ahead
 */
function computeHorizon(now: Date): Date {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  return horizon;
}

export async function runEventInstanceGenerationCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const MAX_CATCHUP = 10;

  // Fetch all active templates (is_series_parent = true, not archived, has recurrence_rule)
  const templates = await db
    .select({
      id: events.id,
      type: events.type,
      title: events.title,
      description: events.description,
      startAt: events.startAt,
      endAt: events.endAt,
      capacity: events.capacity,
      createdBy: events.createdBy,
      recurrenceRule: events.recurrenceRule,
      attachments: events.attachments,
      lastGeneratedDate: events.lastGeneratedDate,
      generationCount: events.generationCount,
      visibilityOffsetHours: events.visibilityOffsetHours,
      visibleAt: events.visibleAt,
    })
    .from(events)
    .where(
      and(
        eq(events.isSeriesParent, true),
        isNull(events.archivedAt),
        not(isNull(events.recurrenceRule)),
      ),
    );

  for (const template of templates) {
    const rule = parseRecurrenceRule(template.recurrenceRule);
    if (!rule) {
      continue;
    }

    const templateStart = new Date(template.startAt);
    if (!isValidDate(templateStart)) {
      continue;
    }

    // Check end conditions
    if (rule.endAfter && template.generationCount >= rule.endAfter) {
      continue;
    }
    if (rule.endDate) {
      const endDate = new Date(rule.endDate);
      if (isValidDate(endDate) && now > endDate) {
        continue;
      }
    }

    // Determine anchor: last generated date or template start
    let anchor = templateStart;
    if (template.lastGeneratedDate) {
      const lastGenDate = new Date(`${template.lastGeneratedDate}T00:00:00Z`);
      if (isValidDate(lastGenDate)) {
        // Use last generated date with template's time
        lastGenDate.setUTCHours(templateStart.getUTCHours(), templateStart.getUTCMinutes(), templateStart.getUTCSeconds(), 0);
        anchor = lastGenDate;
      }
    }

    const horizon = computeHorizon(now);
    let currentAnchor = anchor;
    let generationCount = template.generationCount;
    let catchupCount = 0;

    while (catchupCount < MAX_CATCHUP) {
      const nextOccurrence = computeNextOccurrence(currentAnchor, templateStart, rule);
      if (!nextOccurrence) {
        break;
      }

      // Stop if beyond the lookahead horizon
      if (nextOccurrence > horizon) {
        break;
      }

      // Stop if beyond the rule's end date
      if (rule.endDate) {
        const endDate = new Date(rule.endDate);
        if (isValidDate(endDate) && nextOccurrence > endDate) {
          break;
        }
      }

      const nextStartIso = nextOccurrence.toISOString();
      const nextDateKey = toDateKey(nextOccurrence);

      // Check for duplicate: skip if an instance already exists with the same seriesId and instanceDate
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.seriesId, template.id), eq(events.instanceDate, nextDateKey)))
        .limit(1);

      if (existing.length === 0) {
        let visibleAt: string | null = null;
        if (template.visibleAt) {
          visibleAt = template.visibleAt;
        } else if (template.visibilityOffsetHours != null) {
          visibleAt = new Date(nextOccurrence.getTime() - template.visibilityOffsetHours * 3_600_000).toISOString();
        }

        await db.insert(events).values({
          id: nanoid(),
          type: template.type,
          title: template.title,
          description: template.description,
          startAt: nextStartIso,
          endAt: computeEndAt(template.startAt, template.endAt, nextStartIso),
          capacity: template.capacity,
          pinned: false,
          signupLocked: false,
          visibleAt,
          archivedAt: null,
          createdBy: template.createdBy,
          recurrenceRule: null,
          attachments: template.attachments,
          seriesId: template.id,
          isSeriesParent: false,
          instanceDate: nextDateKey,
          lastGeneratedDate: null,
          generationCount: 0,
          updatedAt: now.toISOString(),
        });

        generationCount += 1;

        // Update template tracking
        await db
          .update(events)
          .set({
            lastGeneratedDate: nextDateKey,
            generationCount,
            updatedAt: now.toISOString(),
          })
          .where(eq(events.id, template.id));
      }

      currentAnchor = nextOccurrence;
      catchupCount += 1;

      // Stop if endAfter limit reached
      if (rule.endAfter && generationCount >= rule.endAfter) {
        break;
      }
    }
  }
}
