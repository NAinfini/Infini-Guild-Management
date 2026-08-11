/**
 * Recurrence timezone contract.
 *
 * The database stores recurrence schedules purely in UTC:
 * - `recurring_templates.start_time` is a **UTC** wall-clock "HH:mm".
 * - `recurrence_rule.daysOfWeek` are **UTC weekdays** (0=Sun..6=Sat).
 *
 * The backend cron (`event-instance-gen.ts`) does no timezone math at all; the
 * UI converts the user's local time/weekday selection to UTC before persisting
 * and back for display, using the viewer's *current* offset. Both weekday
 * conversions anchor their local↔UTC day shift on an instant at the template's
 * UTC time so they are exact inverses across near-midnight times.
 *
 * This is the single source of truth for that conversion — imported by the
 * portal so the frontend and backend cannot drift.
 */

/** Local→UTC day shift (0 or +1, expressed mod 7) at the given instant. */
function utcDayShift(startAtIso: string): number | null {
  const start = new Date(startAtIso);
  if (Number.isNaN(start.getTime())) return null;
  return ((start.getUTCDay() - start.getDay()) % 7 + 7) % 7;
}

/** Convert a locally-selected weekday to the UTC weekday to persist. */
export function localWeekdayToUtc(localDay: number, startAtIso: string): number {
  const shift = utcDayShift(startAtIso);
  if (shift === null) return localDay;
  return (localDay + shift) % 7;
}

/** Convert a stored UTC weekday back to the user's local weekday for display. */
export function utcWeekdayToLocal(utcDay: number, startAtIso: string): number {
  const shift = utcDayShift(startAtIso);
  if (shift === null) return utcDay;
  return (utcDay - shift + 7) % 7;
}

export type NextOccurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
};

const DAY_MS = 86_400_000;

/**
 * Return the next UTC occurrence after `anchor`.
 * Shared by the portal preview and the worker generator so their schedules
 * cannot drift.
 */
export function computeNextOccurrence(
  anchor: Date,
  utcHour: number,
  utcMinute: number,
  rule: NextOccurrenceRule,
  referenceDate: Date,
): Date | null {
  if (rule.frequency === "daily") {
    const next = new Date(anchor);
    next.setUTCDate(next.getUTCDate() + rule.interval);
    next.setUTCHours(utcHour, utcMinute, 0, 0);
    return Number.isFinite(next.getTime()) ? next : null;
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
      if (days.includes(cursor.getUTCDay())) {
        const refDay = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
        const cursorDay = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate());
        const weeksDiff = Math.floor(Math.round((cursorDay - refDay) / DAY_MS) / 7);
        if (weeksDiff >= 0 && weeksDiff % rule.interval === 0) {
          return cursor;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return null;
  }

  const next = new Date(anchor);
  // Move through the first of the target month before clamping. Advancing a
  // January 31st directly lets Date roll into March and silently skips
  // February, which makes recurrence replay depend on the previous clamp.
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + rule.interval);
  if (rule.dayOfMonth) {
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(rule.dayOfMonth, lastDay));
  }
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  return Number.isFinite(next.getTime()) ? next : null;
}
