import type { Bindings } from "../index";

/**
 * Auto-archives events whose end time (or start time if no end) has passed.
 * Runs every 15 minutes. Only touches enabled, non-archived events once.
 */
export async function runEventAutoArchiveCron(env: Bindings): Promise<void> {
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE events
     SET archived_at = ?1, updated_at = ?1, auto_archived = 1
     WHERE archived_at IS NULL
       AND auto_archive = 1
       AND auto_archived = 0
       AND is_series_parent = 0
       AND (
         (end_at IS NOT NULL AND end_at < ?1)
         OR (end_at IS NULL AND start_at < ?1)
       )
       AND NOT (
         type = 'raffle'
         AND NOT EXISTS (SELECT 1 FROM event_raffle_winners w WHERE w.event_id = events.id)
       )`,
  )
    .bind(now)
    .run();
}
