import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";
import { localWeekdayToUtc, utcWeekdayToLocal } from "@guild/shared/utils/recurrence";

export { localWeekdayToUtc, utcWeekdayToLocal };

export type RecurrenceFreq = "daily" | "weekly" | "monthly";
export type RecurrenceEndMode = "never" | "date" | "count";
export type DurationUnit = "minutes" | "hours";

export type RecurringTemplateFormPayload = {
  type: (typeof EVENT_TYPES)[number];
  title: string;
  description?: string;
  start_time: string;
  duration_minutes?: number;
  timezone_offset_minutes: number;
  capacity?: number;
  recurrence_rule: {
    frequency: RecurrenceFreq;
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endAfter?: number;
    endDate?: string;
  };
  visibility_offset_minutes?: number;
  auto_archive?: boolean;
};

export type RecurringTemplateFormState = {
  title: string;
  eventType: (typeof EVENT_TYPES)[number];
  description: string;
  startTime: string;
  durationValue: number;
  durationUnit: DurationUnit;
  capacity: string;
  visibilityOffsetDays: number | "";
  visibilityOffsetHours: number | "";
  visibilityOffsetMinutes: number | "";
  autoArchive: boolean;
  recurrenceFreq: RecurrenceFreq;
  recurrenceInterval: string;
  recurrenceDays: number[];
  recurrenceMonthDay: string;
  recurrenceEndMode: RecurrenceEndMode;
  recurrenceEndDate: string;
  recurrenceEndCount: string;
};

export const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

/**
 * Build a synthetic ISO string whose local-vs-UTC day shift matches the given
 * timezone offset in minutes.  This lets us reuse the existing
 * `localWeekdayToUtc` / `utcWeekdayToLocal` helpers that expect an ISO anchor.
 */
export function tzOffsetToAnchorIso(offsetMinutes: number): string {
  return new Date(Date.UTC(2026, 0, 4, 0, 0) - offsetMinutes * 60_000).toISOString();
}

function durationFromMinutes(totalMinutes: number | null): { value: number; unit: DurationUnit } {
  if (totalMinutes == null || totalMinutes <= 0) return { value: 2, unit: "hours" };
  if (totalMinutes < 60) return { value: totalMinutes, unit: "minutes" };
  if (totalMinutes % 60 === 0) return { value: totalMinutes / 60, unit: "hours" };
  return { value: totalMinutes, unit: "minutes" };
}

export function buildFormState(template: RecurringTemplate | null): RecurringTemplateFormState {
  const duration = durationFromMinutes(template?.duration_minutes ?? null);
  const totalMinutes = template?.visibility_offset_minutes ?? null;
  const storedDays = template?.recurrence_rule?.daysOfWeek ?? [1, 3, 5];
  const anchorIso = template ? tzOffsetToAnchorIso(template.timezone_offset_minutes) : null;
  const localDays = anchorIso
    ? storedDays.map((d) => utcWeekdayToLocal(d, anchorIso))
    : storedDays;
  return {
    title: template?.title ?? "",
    eventType: (template?.type as (typeof EVENT_TYPES)[number]) ?? ("" as (typeof EVENT_TYPES)[number]),
    description: template?.description ?? "",
    startTime: template?.start_time ?? "00:00",
    durationValue: duration.value,
    durationUnit: duration.unit,
    capacity: template?.capacity === null ? "" : String(template?.capacity ?? ""),
    recurrenceFreq: template?.recurrence_rule?.frequency ?? "weekly",
    recurrenceInterval: String(template?.recurrence_rule?.interval ?? 1),
    recurrenceDays: localDays,
    recurrenceMonthDay: template?.recurrence_rule?.dayOfMonth ? String(template.recurrence_rule.dayOfMonth) : "1",
    recurrenceEndMode: template?.recurrence_rule?.endDate
      ? "date"
      : template?.recurrence_rule?.endAfter
        ? "count"
        : "never",
    recurrenceEndDate: template?.recurrence_rule?.endDate
      ? template.recurrence_rule.endDate.slice(0, 10)
      : "",
    recurrenceEndCount: template?.recurrence_rule?.endAfter
      ? String(template.recurrence_rule.endAfter)
      : "13",
    visibilityOffsetDays: totalMinutes != null ? Math.floor(totalMinutes / 1440) : 0,
    visibilityOffsetHours: totalMinutes != null ? Math.floor((totalMinutes % 1440) / 60) : 0,
    visibilityOffsetMinutes: totalMinutes != null ? totalMinutes % 60 : 0,
    autoArchive: template?.auto_archive ?? false,
  };
}

// ─── Lifecycle preview computation ───────────────────────────────────────────

export type LifecyclePreview = {
  creationTime: Date;
  startTime: Date;
  endTime: Date | null;
};

const DAY_MS = 86_400_000;

function parseStartTimeToUtc(
  startTime: string,
  timezoneOffsetMinutes: number,
): { utcHour: number; utcMinute: number } | null {
  const match = startTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const localHour = Number(match[1]);
  const localMinute = Number(match[2]);
  if (localHour < 0 || localHour > 23 || localMinute < 0 || localMinute > 59) return null;
  const totalMinutesLocal = localHour * 60 + localMinute;
  let totalMinutesUtc = totalMinutesLocal - timezoneOffsetMinutes;
  totalMinutesUtc = ((totalMinutesUtc % 1440) + 1440) % 1440;
  return { utcHour: Math.floor(totalMinutesUtc / 60), utcMinute: totalMinutesUtc % 60 };
}

function computeNextOccurrence(
  anchor: Date,
  utcHour: number,
  utcMinute: number,
  rule: { frequency: RecurrenceFreq; interval: number; daysOfWeek?: number[]; dayOfMonth?: number },
  referenceDate: Date,
): Date | null {
  if (rule.frequency === "daily") {
    const next = new Date(anchor);
    next.setUTCDate(next.getUTCDate() + rule.interval);
    next.setUTCHours(utcHour, utcMinute, 0, 0);
    return next;
  }

  if (rule.frequency === "weekly") {
    const days =
      rule.daysOfWeek && rule.daysOfWeek.length > 0
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

  const next = new Date(anchor);
  next.setUTCMonth(next.getUTCMonth() + rule.interval);
  if (rule.dayOfMonth) {
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(rule.dayOfMonth, lastDay));
  }
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  return next;
}

export function computeNextLifecyclePreview(
  formState: RecurringTemplateFormState,
  template: RecurringTemplate | null,
  mode: "create" | "edit",
): LifecyclePreview | null {
  if (!formState.startTime) return null;

  const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
  const utcTime = parseStartTimeToUtc(formState.startTime, timezoneOffsetMinutes);
  if (!utcTime) return null;

  const anchorIso = tzOffsetToAnchorIso(timezoneOffsetMinutes);
  const interval = Math.max(1, Number.parseInt(formState.recurrenceInterval || "1", 10));
  const daysOfWeek =
    formState.recurrenceFreq === "weekly"
      ? Array.from(new Set(formState.recurrenceDays.map((d) => localWeekdayToUtc(d, anchorIso)))).sort((a, b) => a - b)
      : undefined;
  const dayOfMonth =
    formState.recurrenceFreq === "monthly"
      ? Math.max(1, Math.min(31, Number.parseInt(formState.recurrenceMonthDay || "1", 10)))
      : undefined;

  const rule = { frequency: formState.recurrenceFreq, interval, daysOfWeek, dayOfMonth };

  const now = new Date();
  let referenceDate: Date;
  let anchor: Date;

  if (mode === "edit" && template) {
    referenceDate = new Date(template.created_at);
    if (template.last_generated_date) {
      anchor = new Date(`${template.last_generated_date}T00:00:00Z`);
      anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
    } else {
      anchor = new Date(referenceDate);
      anchor.setUTCDate(anchor.getUTCDate() - 1);
      anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
    }
  } else {
    referenceDate = now;
    anchor = new Date(now);
    anchor.setUTCDate(anchor.getUTCDate() - 1);
    anchor.setUTCHours(utcTime.utcHour, utcTime.utcMinute, 0, 0);
  }

  const nextStart = computeNextOccurrence(anchor, utcTime.utcHour, utcTime.utcMinute, rule, referenceDate);
  if (!nextStart) return null;

  const offsetD = typeof formState.visibilityOffsetDays === "number" ? formState.visibilityOffsetDays : 0;
  const offsetH = typeof formState.visibilityOffsetHours === "number" ? formState.visibilityOffsetHours : 0;
  const offsetM = typeof formState.visibilityOffsetMinutes === "number" ? formState.visibilityOffsetMinutes : 0;
  const totalOffsetMs = (offsetD * 1440 + offsetH * 60 + offsetM) * 60_000;

  const creationTime = totalOffsetMs > 0 ? new Date(nextStart.getTime() - totalOffsetMs) : nextStart;

  const durationMinutes =
    formState.durationValue > 0
      ? formState.durationValue * (formState.durationUnit === "hours" ? 60 : 1)
      : 0;
  const endTime = durationMinutes > 0 ? new Date(nextStart.getTime() + durationMinutes * 60_000) : null;

  return { creationTime, startTime: nextStart, endTime };
}

export function formatLifecycleDate(date: Date, locale: string): string {
  const datePart = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const weekdayPart = new Intl.DateTimeFormat(locale, {
    weekday: "short",
  }).format(date);
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${datePart} (${weekdayPart}) ${timePart}`;
}
