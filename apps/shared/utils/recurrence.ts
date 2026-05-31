/**
 * Recurrence weekday timezone contract.
 *
 * `recurrence_rule.daysOfWeek` is stored as **UTC weekdays** (0=Sun..6=Sat).
 * The backend cron (`event-instance-gen.ts`) operates purely in UTC, so the UI
 * must convert the user's locally-selected weekday(s) to UTC before persisting,
 * and convert back when displaying. Both conversions anchor their local↔UTC day
 * shift on the template's `start_at` instant so they are exact inverses across
 * DST boundaries and near-midnight times.
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
