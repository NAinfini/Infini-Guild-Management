import type { Bindings } from "../index";

/**
 * Auto-archives events whose end time (or start time if no end) has passed.
 * Runs every 15 minutes. Only touches non-archived events.
 */
export async function runEventAutoArchiveCron(env: Bindings): Promise<void> {
  const now = new Date().toISOString();

  // Archive events where:
  // - not already archived
  // - not a recurring series parent (templates must stay active to generate instances)
  // - end_at is set and in the past, OR end_at is null and start_at is in the past
  await env.DB.prepare(
    `UPDATE events
     SET archived_at = ?1, updated_at = ?1
     WHERE archived_at IS NULL
       AND is_series_parent = 0
       AND (
         (end_at IS NOT NULL AND end_at < ?1)
         OR (end_at IS NULL AND start_at < ?1)
       )`,
  )
    .bind(now)
    .run();
}
