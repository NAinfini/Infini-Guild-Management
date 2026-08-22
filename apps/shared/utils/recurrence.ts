/**
 * Recurrence timezone contract.
 *
 * The database stores recurrence schedules purely in UTC:
 * - `recurring_templates.start_time` is a **UTC** wall-clock "HH:mm".
 * - `recurrence_rule.daysOfWeek` are **UTC weekdays** (0=Sun..6=Sat).
 * - `recurrence_rule.dayOfMonth` is a **UTC calendar day** (1..31).
 *
 * The backend cron (`event-instance-gen.ts`) does no timezone math at all; the
 * UI converts the user's local time/weekday selection to UTC before persisting
 * and back for display, using the offset at the actual relevant occurrence or
 * reference date. Both weekday conversions anchor their local↔UTC day shift
 * on an instant at the template's UTC time so they are exact inverses across
 * near-midnight times.
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

function utcMidnight(value: Date): Date | null {
  if (!Number.isFinite(value.getTime())) return null;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function occurrenceAt(day: Date, utcHour: number, utcMinute: number): Date | null {
  if (!Number.isInteger(utcHour) || !Number.isInteger(utcMinute)) return null;
  const occurrence = new Date(day);
  occurrence.setUTCHours(utcHour, utcMinute, 0, 0);
  return Number.isFinite(occurrence.getTime()) ? occurrence : null;
}

/**
 * Cursor used when a schedule starts, resumes, or changes rule.  It is the
 * prior UTC calendar day, so the next lookup includes the reference day but
 * never backfills older dates.
 */
export function recurrenceCursorBefore(reference: Date): Date | null {
  const cursor = utcMidnight(reference);
  if (!cursor) return null;
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor;
}

/**
 * Return the next schedule occurrence after a calendar-date cursor.
 *
 * The cursor is a processed date boundary, not necessarily an occurrence.
 * `referenceDate` fixes the recurrence phase while the cursor determines the
 * earliest date eligible for materialization.  This is shared by the worker
 * and preview so first occurrences, rule changes, and resumes agree.
 */
export function computeNextOccurrenceFromCursor(
  cursor: Date,
  utcHour: number,
  utcMinute: number,
  rule: NextOccurrenceRule,
  referenceDate: Date,
): Date | null {
  const cursorDay = utcMidnight(cursor);
  const referenceDay = utcMidnight(referenceDate);
  if (!cursorDay || !referenceDay || rule.interval < 1) return null;
  const firstDay = new Date(Math.max(cursorDay.getTime() + DAY_MS, referenceDay.getTime()));

  if (rule.frequency === "daily") {
    const elapsedDays = Math.round((firstDay.getTime() - referenceDay.getTime()) / DAY_MS);
    const offset = (rule.interval - (elapsedDays % rule.interval)) % rule.interval;
    return occurrenceAt(new Date(firstDay.getTime() + offset * DAY_MS), utcHour, utcMinute);
  }

  if (rule.frequency === "weekly") {
    const days = rule.daysOfWeek && rule.daysOfWeek.length > 0
      ? [...rule.daysOfWeek].sort((left, right) => left - right)
      : [referenceDay.getUTCDay()];
    const referenceWeek = new Date(referenceDay);
    referenceWeek.setUTCDate(referenceWeek.getUTCDate() - referenceWeek.getUTCDay());
    const firstWeek = Math.floor((firstDay.getTime() - referenceWeek.getTime()) / (7 * DAY_MS));
    let activeWeek = firstWeek + ((rule.interval - (firstWeek % rule.interval)) % rule.interval);
    for (let index = 0; index < 2; index += 1) {
      const weekStart = new Date(referenceWeek.getTime() + activeWeek * 7 * DAY_MS);
      for (const weekday of days) {
        const candidate = new Date(weekStart.getTime() + weekday * DAY_MS);
        if (candidate >= firstDay) return occurrenceAt(candidate, utcHour, utcMinute);
      }
      activeWeek += rule.interval;
    }
    return null;
  }

  const referenceMonth = referenceDay.getUTCFullYear() * 12 + referenceDay.getUTCMonth();
  const firstMonth = firstDay.getUTCFullYear() * 12 + firstDay.getUTCMonth();
  let monthOffset = Math.max(0, firstMonth - referenceMonth);
  monthOffset += (rule.interval - (monthOffset % rule.interval)) % rule.interval;
  const dayOfMonth = rule.dayOfMonth ?? referenceDay.getUTCDate();
  for (let index = 0; index < 2; index += 1) {
    const candidate = new Date(Date.UTC(referenceDay.getUTCFullYear(), referenceDay.getUTCMonth() + monthOffset, 1));
    const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
    candidate.setUTCDate(Math.min(dayOfMonth, lastDay));
    if (candidate >= firstDay) return occurrenceAt(candidate, utcHour, utcMinute);
    monthOffset += rule.interval;
  }
  return null;
}
