import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";
// Local<->UTC weekday conversion lives in the shared package so the portal and the
// backend cron cannot drift on the `daysOfWeek` = UTC-weekday contract.
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
    startTime: template?.start_time ?? "",
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
    visibilityOffsetDays: totalMinutes != null ? Math.floor(totalMinutes / 1440) : "",
    visibilityOffsetHours: totalMinutes != null ? Math.floor((totalMinutes % 1440) / 60) : "",
    visibilityOffsetMinutes: totalMinutes != null ? totalMinutes % 60 : "",
    autoArchive: template?.auto_archive ?? false,
  };
}
