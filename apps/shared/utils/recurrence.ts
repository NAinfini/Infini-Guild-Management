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
