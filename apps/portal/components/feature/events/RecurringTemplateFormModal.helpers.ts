import type { EventClassQuotaInput, EventType, RecurringTemplate } from "@guild/shared";
import { computeNextOccurrence, localWeekdayToUtc, utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import { toClassQuotaInputs } from "./class-quota-view";

export { localWeekdayToUtc, utcWeekdayToLocal };

export type RecurrenceFreq = "daily" | "weekly" | "monthly";
export type RecurrenceEndMode = "never" | "date" | "count";
export type DurationUnit = "minutes" | "hours";

export type RecurringTemplateFormPayload = {
  type: EventType;
  title: string;
  description?: string;
  /** UTC wall-clock "HH:mm" — converted from the local form input before submit. */
  start_time: string;
  duration_minutes?: number;
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
  class_quotas: EventClassQuotaInput[];
};

export type RecurringTemplateFormState = {
  title: string;
  eventType: EventType | "";
  description: string;
  startTime: string;
  durationValue: number;
  durationUnit: DurationUnit;
  capacity: string;
  classQuotas: EventClassQuotaInput[];
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
 * timezone offset and start time.  The day-shift depends on the *actual event
 * time*, not midnight — e.g. 17:00 in UTC+8 is 09:00 UTC (same day), while
 * 00:00 in UTC+8 is 16:00 UTC the previous day.
 */
export function tzOffsetToAnchorIso(offsetMinutes: number, startTime = "12:00"): string {
  const match = startTime.match(/^(\d{1,2}):(\d{2})$/);
  const localHour = match ? Number(match[1]) : 12;
  const localMinute = match ? Number(match[2]) : 0;
  const baseMs = Date.UTC(2026, 0, 4, localHour, localMinute);
  return new Date(baseMs - offsetMinutes * 60_000).toISOString();
}

/** Shift an "HH:mm" wall-clock by deltaMinutes, wrapping at midnight. */
function shiftHHmm(time: string, deltaMinutes: number): string | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const total = (((hour * 60 + minute + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Convert a stored UTC "HH:mm" to the viewer's local wall-clock for display.
 * Returns the input verbatim if it is not a valid "HH:mm" so bad data stays
 * visible instead of being masked.
 */
export function utcTimeToLocalTime(utcTime: string): string {
  return shiftHHmm(utcTime, -new Date().getTimezoneOffset()) ?? utcTime;
}

/** Convert a locally-entered "HH:mm" to the UTC "HH:mm" to persist. */
export function localTimeToUtcTime(localTime: string): string {
  return shiftHHmm(localTime, new Date().getTimezoneOffset()) ?? localTime;
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
  // start_time is stored as UTC; anchor on the instant at that UTC time so the
  // weekday conversion matches the viewer's actual local offset.
  const anchorIso = template ? tzOffsetToAnchorIso(0, template.start_time) : null;
  const localDays = anchorIso
    ? storedDays.map((d) => utcWeekdayToLocal(d, anchorIso))
    : storedDays;
  return {
    title: template?.title ?? "",
    eventType: template?.type ?? "",
    description: template?.description ?? "",
    startTime: template ? utcTimeToLocalTime(template.start_time) : "00:00",
    durationValue: duration.value,
    durationUnit: duration.unit,
    capacity: template?.capacity === null ? "" : String(template?.capacity ?? ""),
    classQuotas: toClassQuotaInputs(template?.class_quotas ?? []),
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

export function computeNextLifecyclePreview(
  formState: RecurringTemplateFormState,
  template: RecurringTemplate | null,
  mode: "create" | "edit",
): LifecyclePreview | null {
  if (!formState.startTime) return null;

  const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
  const utcTime = parseStartTimeToUtc(formState.startTime, timezoneOffsetMinutes);
  if (!utcTime) return null;

  const anchorIso = tzOffsetToAnchorIso(timezoneOffsetMinutes, formState.startTime);
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
