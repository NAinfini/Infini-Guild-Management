import type { EventClassQuotaInput, EventType, RecurrenceRule, RecurringTemplate } from "@guild/shared";
import {
  computeNextOccurrenceFromCursor,
  localWeekdayToUtc,
  recurrenceCursorBefore,
  utcWeekdayToLocal,
} from "@guild/shared/utils/recurrence";
import {
  formatLocaleParts,
  parseClockMinutes,
} from "../../../utils/datetime";
import { toClassQuotaInputs } from "./class-quota-view";

export { localWeekdayToUtc, utcWeekdayToLocal };

export type RecurrenceFreq = RecurrenceRule["frequency"];
export type RecurrenceEndMode = "never" | "date" | "count";
export type DurationUnit = "minutes" | "hours";

export type RecurringTemplateFormPayload = {
  type: EventType;
  title: string;
  description: string | null;
  /** UTC wall-clock "HH:mm" — converted from the local form input before submit. */
  start_time: string;
  duration_minutes?: number | null;
  capacity?: number | null;
  recurrence_rule: RecurrenceRule;
  visibility_offset_minutes: number;
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

export function buildRecurrenceRule(
  formState: Pick<
    RecurringTemplateFormState,
    | "recurrenceFreq"
    | "recurrenceInterval"
    | "recurrenceDays"
    | "recurrenceMonthDay"
    | "recurrenceEndMode"
    | "recurrenceEndDate"
    | "recurrenceEndCount"
  >,
  anchorIso: string,
): RecurrenceRule {
  const interval = Math.max(1, Number.parseInt(formState.recurrenceInterval || "1", 10));
  const end = formState.recurrenceEndMode === "count"
    ? { endAfter: Math.max(1, Number.parseInt(formState.recurrenceEndCount || "1", 10)) }
    : formState.recurrenceEndMode === "date" && formState.recurrenceEndDate.trim()
      ? { endDate: new Date(formState.recurrenceEndDate).toISOString() }
      : {};

  if (formState.recurrenceFreq === "daily") {
    return { frequency: "daily", interval, ...end };
  }
  if (formState.recurrenceFreq === "weekly") {
    return {
      frequency: "weekly",
      interval,
      daysOfWeek: Array.from(new Set(
        formState.recurrenceDays.map((day) => localWeekdayToUtc(day, anchorIso)),
      )).sort((a, b) => a - b),
      ...end,
    };
  }
  return {
    frequency: "monthly",
    interval,
    dayOfMonth: Math.max(1, Math.min(31, Number.parseInt(formState.recurrenceMonthDay || "1", 10))),
    ...end,
  };
}

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localDateAtClock(referenceDate: Date, time: string): Date | null {
  const minutes = parseClockMinutes(time);
  if (minutes === null || !Number.isFinite(referenceDate.getTime())) return null;
  const date = new Date(referenceDate);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function utcDateAtClock(referenceDate: Date, time: string): Date | null {
  const minutes = parseClockMinutes(time);
  if (minutes === null || !Number.isFinite(referenceDate.getTime())) return null;
  const date = new Date(referenceDate);
  date.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

/** An actual local date/time anchor for a form clock value, including that date's DST offset. */
export function localClockAnchorIso(time: string, referenceDate = new Date()): string {
  return localDateAtClock(referenceDate, time)?.toISOString() ?? "";
}

/** Convert a local form clock using the offset at its relevant calendar date. */
export function localClockToUtcAt(time: string, referenceDate: Date): string {
  const date = localDateAtClock(referenceDate, time);
  return date ? formatClock(date.getUTCHours(), date.getUTCMinutes()) : time;
}

/** Convert a stored UTC clock using the offset at its relevant calendar date. */
export function utcClockToLocalAt(time: string, referenceDate: Date): string {
  const date = utcDateAtClock(referenceDate, time);
  return date ? formatClock(date.getHours(), date.getMinutes()) : time;
}

/** The actual UTC start instant for the template date that drives local display. */
export function templateScheduleAnchor(template: RecurringTemplate): Date | null {
  const referenceDate = template.last_generated_date
    ? new Date(`${template.last_generated_date}T00:00:00.000Z`)
    : new Date(template.created_at);
  return utcDateAtClock(referenceDate, template.start_time);
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
  const recurrenceRule = template?.recurrence_rule;
  const storedDays = recurrenceRule?.frequency === "weekly" ? recurrenceRule.daysOfWeek : [1, 3, 5];
  // start_time is stored as UTC; anchor on an actual template-related instant
  // so weekday conversion uses that date's real DST offset.
  const scheduleAnchor = template ? templateScheduleAnchor(template) : null;
  const anchorIso = scheduleAnchor?.toISOString() ?? null;
  const localDays = anchorIso
    ? storedDays.map((d) => utcWeekdayToLocal(d, anchorIso))
    : storedDays;
  return {
    title: template?.title ?? "",
    eventType: template?.type ?? "",
    description: template?.description ?? "",
    startTime: template && scheduleAnchor
      ? formatClock(scheduleAnchor.getHours(), scheduleAnchor.getMinutes())
      : template?.start_time ?? "00:00",
    durationValue: duration.value,
    durationUnit: duration.unit,
    capacity: template?.capacity === null ? "" : String(template?.capacity ?? ""),
    classQuotas: toClassQuotaInputs(template?.class_quotas ?? []),
    recurrenceFreq: recurrenceRule?.frequency ?? "weekly",
    recurrenceInterval: String(recurrenceRule?.interval ?? 1),
    recurrenceDays: localDays,
    recurrenceMonthDay: recurrenceRule?.frequency === "monthly"
      ? String(recurrenceRule.dayOfMonth)
      : "1",
    recurrenceEndMode: recurrenceRule?.endDate
      ? "date"
      : recurrenceRule?.endAfter
        ? "count"
        : "never",
    recurrenceEndDate: recurrenceRule?.endDate
      ? recurrenceRule.endDate.slice(0, 10)
      : "",
    recurrenceEndCount: recurrenceRule?.endAfter
      ? String(recurrenceRule.endAfter)
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

/* 共享游标计算要 UTC 的时与分；无效挂钟会保留原值并在此解析失败。 */
function parseUtcStartTime(
  localStartTime: string,
  referenceDate: Date,
): { utcHour: number; utcMinute: number } | null {
  const utcMinutes = parseClockMinutes(localClockToUtcAt(localStartTime, referenceDate));
  if (utcMinutes === null) return null;
  return { utcHour: Math.floor(utcMinutes / 60), utcMinute: utcMinutes % 60 };
}

export function computeNextLifecyclePreview(
  formState: RecurringTemplateFormState,
  template: RecurringTemplate | null,
  mode: "create" | "edit",
): LifecyclePreview | null {
  if (!formState.startTime) return null;

  const now = new Date();
  const referenceDate = mode === "edit" && template ? new Date(template.created_at) : now;
  if (!Number.isFinite(referenceDate.getTime())) return null;

  const cursor = mode === "edit" && template?.last_generated_date
    ? new Date(`${template.last_generated_date}T00:00:00.000Z`)
    : recurrenceCursorBefore(now);
  if (!cursor || !Number.isFinite(cursor.getTime())) return null;

  const timezoneReference = mode === "edit" && template?.last_generated_date ? cursor : now;
  const utcTime = parseUtcStartTime(formState.startTime, timezoneReference);
  if (!utcTime) return null;

  const anchorIso = localClockAnchorIso(formState.startTime, timezoneReference);
  const rule = buildRecurrenceRule(formState, anchorIso);

  const nextStart = computeNextOccurrenceFromCursor(
    cursor,
    utcTime.utcHour,
    utcTime.utcMinute,
    rule,
    referenceDate,
  );
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
  const datePart = formatLocaleParts(date, locale, { month: "2-digit", day: "2-digit" });
  const weekdayPart = formatLocaleParts(date, locale, { weekday: "short" });
  const timePart = formatLocaleParts(date, locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${datePart} (${weekdayPart}) ${timePart}`;
}
