import { EVENT_TYPES, type RecurringTemplate } from "@guild/shared";

export type RecurrenceFreq = "daily" | "weekly" | "monthly";
export type RecurrenceEndMode = "never" | "date" | "count";
export type DurationUnit = "minutes" | "hours";

export type RecurringTemplateFormPayload = {
  type: (typeof EVENT_TYPES)[number];
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
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

export function extractTimeFromIso(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function computeDurationFromIso(startIso: string | null, endIso: string | null): { value: number; unit: DurationUnit } {
  if (!startIso || !endIso) return { value: 2, unit: "hours" };
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { value: 2, unit: "hours" };
  }
  const diffMinutes = Math.round((endMs - startMs) / 60_000);
  if (diffMinutes > 0 && diffMinutes < 60) {
    return { value: diffMinutes, unit: "minutes" };
  }
  const diffHours = diffMinutes / 60;
  if (Number.isInteger(diffHours)) {
    return { value: diffHours, unit: "hours" };
  }
  return { value: diffMinutes, unit: "minutes" };
}

export function timeToTodayIso(time: string): string | undefined {
  if (!time) return undefined;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function addDuration(startIso: string, durationValue: number, durationUnit: DurationUnit): string {
  const startMs = Date.parse(startIso);
  const durationMs = durationUnit === "hours" ? durationValue * 3_600_000 : durationValue * 60_000;
  return new Date(startMs + durationMs).toISOString();
}

export function buildFormState(template: RecurringTemplate | null): RecurringTemplateFormState {
  const duration = computeDurationFromIso(template?.start_at ?? null, template?.end_at ?? null);
  const totalMinutes = template?.visibility_offset_minutes ?? null;
  return {
    title: template?.title ?? "",
    eventType: (template?.type as (typeof EVENT_TYPES)[number]) ?? ("" as (typeof EVENT_TYPES)[number]),
    description: template?.description ?? "",
    startTime: template ? extractTimeFromIso(template.start_at) : "",
    durationValue: duration.value,
    durationUnit: duration.unit,
    capacity: template?.capacity === null ? "" : String(template?.capacity ?? ""),
    recurrenceFreq: template?.recurrence_rule?.frequency ?? "weekly",
    recurrenceInterval: String(template?.recurrence_rule?.interval ?? 1),
    recurrenceDays: template?.recurrence_rule?.daysOfWeek ?? [1, 3, 5],
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
    visibilityOffsetHours: totalMinutes != null ? Math.floor(totalMinutes / 60) : "",
    visibilityOffsetMinutes: totalMinutes != null ? totalMinutes % 60 : "",
    autoArchive: template?.auto_archive ?? false,
  };
}
