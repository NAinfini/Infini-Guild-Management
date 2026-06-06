import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { events, recurringTemplates } from "../db/schema";
import type { Bindings } from "../index";
import { logger } from "../utils/logger";

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
  } catch (e) {
    logger.warn("Failed to parse recurrence rule", { value, error: String(e) });
    return null;
  }
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseStartTime(startTime: string, timezoneOffsetMinutes: number): { utcHour: number; utcMinute: number } | null {
  const match = startTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const localHour = Number(match[1]);
  const localMinute = Number(match[2]);
  if (localHour < 0 || localHour > 23 || localMinute < 0 || localMinute > 59) {
    return null;
  }

  const totalMinutesLocal = localHour * 60 + localMinute;
  let totalMinutesUtc = totalMinutesLocal - timezoneOffsetMinutes;
  totalMinutesUtc = ((totalMinutesUtc % 1440) + 1440) % 1440;
  return { utcHour: Math.floor(totalMinutesUtc / 60), utcMinute: totalMinutesUtc % 60 };
}

function computeNextOccurrence(anchor: Date, utcHour: number, utcMinute: number, rule: RecurrenceRule, referenceDate: Date): Date | null {
  if (rule.frequency === "daily") {
    const next = new Date(anchor);
    next.setUTCDate(next.getUTCDate() + rule.interval);
    next.setUTCHours(utcHour, utcMinute, 0, 0);
    return isValidDate(next) ? next : null;
  }

  if (rule.frequency === "weekly") {
    const days = rule.daysOfWeek && rule.daysOfWeek.length > 0
      ? [...rule.daysOfWeek].sort((a, b) => a - b)
      : [referenceDate.getUTCDay()];

    const cursor = new Date(anchor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(utcHour, utcMinute, 0, 0);

    const maxScan = rule.interval * 7 + 7;
    for (let i = 0; i < maxScan; i++) {
      const candidateDay = cursor.getUTCDay();
      if (days.includes(candidateDay)) {
        const refDay = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
        const cursorDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
        const daysDiff = Math.round((cursorDay.getTime() - refDay.getTime()) / DAY_MS);
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
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(rule.dayOfMonth, lastDay));
  }
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  return isValidDate(next) ? next : null;
}

export function computeHorizon(now: Date, offsetMinutes = 0): Date {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 3);
  horizon.setTime(horizon.getTime() + offsetMinutes * 60_000);
  return horizon;
}

export async function runEventInstanceGenerationCron(env: Bindings, options: { templateId?: string } = {}): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
  const MAX_CATCHUP = 10;

  const templates = await db
    .select({
      id: recurringTemplates.id,
      type: recurringTemplates.type,
      title: recurringTemplates.title,
      description: recurringTemplates.description,
      startTime: recurringTemplates.startTime,
      durationMinutes: recurringTemplates.durationMinutes,
      capacity: recurringTemplates.capacity,
      createdBy: recurringTemplates.createdBy,
      recurrenceRule: recurringTemplates.recurrenceRule,
      attachments: recurringTemplates.attachments,
      lastGeneratedDate: recurringTemplates.lastGeneratedDate,
      generationCount: recurringTemplates.generationCount,
      visibilityOffsetMinutes: recurringTemplates.visibilityOffsetMinutes,
      autoArchive: recurringTemplates.autoArchive,
      timezoneOffsetMinutes: recurringTemplates.timezoneOffsetMinutes,
      createdAt: recurringTemplates.createdAt,
    })
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.paused, false),
        ...(options.templateId ? [eq(recurringTemplates.id, options.templateId)] : []),
      ),
    );

  for (const template of templates) {
    const rule = parseRecurrenceRule(template.recurrenceRule);
    if (!rule) {
      continue;
    }

    const utcTime = parseStartTime(template.startTime, template.timezoneOffsetMinutes);
    if (!utcTime) {
      continue;
    }

    // Use createdAt as the reference date for recurrence anchoring
    const referenceDate = new Date(template.createdAt);
    if (!isValidDate(referenceDate)) {
      continue;
    }

    if (rule.endAfter && template.generationCount >= rule.endAfter) {
      continue;
    }
    if (rule.endDate) {
      const endDate = new Date(rule.endDate);
      if (isValidDate(endDate) && now > endDate) {
        continue;
      }
    }

    // Bug 2 fix: when lastGeneratedDate is null, anchor to one day before the reference
    // so computeNextOccurrence naturally finds the reference date itself.
    let anchor: Date;
    if (template.lastGeneratedDate) {
      const lastGenDate = new Date(`${template.lastGeneratedDate}T00:00:00Z`);
      if (isValidDate(lastGenDate)) {
        lastGenDate.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
        anchor = lastGenDate;
      } else {
        anchor = new Date(referenceDate);
        anchor.setUTCDate(anchor.getUTCDate() - 1);
        anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
      }
    } else {
      anchor = new Date(referenceDate);
      anchor.setUTCDate(anchor.getUTCDate() - 1);
      anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
    }

    // Bug 1 fix: extend horizon by visibilityOffsetMinutes so events needing early creation are included
    const horizon = computeHorizon(now, template.visibilityOffsetMinutes);
    let currentAnchor = anchor;
    let generationCount = template.generationCount;
    let catchupCount = 0;
    let lastDateKey: string | null = null;

    while (catchupCount < MAX_CATCHUP) {
      const nextOccurrence = computeNextOccurrence(currentAnchor, utcTime.utcHour, utcTime.utcMinute, rule, referenceDate);
      if (!nextOccurrence) {
        break;
      }

      if (nextOccurrence > horizon) {
        break;
      }

      if (template.visibilityOffsetMinutes > 0) {
        const createAt = new Date(nextOccurrence.getTime() - template.visibilityOffsetMinutes * 60_000);
        if (now < createAt) {
          break;
        }
      }

      if (rule.endDate) {
        const endDate = new Date(rule.endDate);
        if (isValidDate(endDate) && nextOccurrence > endDate) {
          break;
        }
      }

      const nextStartIso = nextOccurrence.toISOString();
      const nextDateKey = toDateKey(nextOccurrence);
      const nextEndAt = template.durationMinutes != null
        ? new Date(nextOccurrence.getTime() + template.durationMinutes * 60_000).toISOString()
        : null;

      const result = await db.insert(events).values({
        id: nanoid(),
        type: template.type,
        title: template.title,
        description: template.description,
        startAt: nextStartIso,
        endAt: nextEndAt,
        capacity: template.capacity,
        pinned: false,
        signupLocked: false,
        autoArchive: template.autoArchive,
        autoArchived: false,
        archivedAt: null,
        createdBy: template.createdBy,
        attachments: template.attachments,
        seriesId: template.id,
        instanceDate: nextDateKey,
        updatedAt: now.toISOString(),
      }).onConflictDoNothing({ target: [events.seriesId, events.instanceDate] });

      if (result.meta.changes > 0) {
        generationCount += 1;
        lastDateKey = nextDateKey;
      }

      currentAnchor = nextOccurrence;
      catchupCount += 1;

      if (rule.endAfter && generationCount >= rule.endAfter) {
        break;
      }
    }

    if (lastDateKey) {
      await db
        .update(recurringTemplates)
        .set({
          lastGeneratedDate: lastDateKey,
          generationCount,
          updatedAt: now.toISOString(),
        })
        .where(eq(recurringTemplates.id, template.id));
    }
  }
}
