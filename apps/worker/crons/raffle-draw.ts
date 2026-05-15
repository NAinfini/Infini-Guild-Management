import type { Bindings } from "../index";
import { nanoid } from "nanoid";

export async function runRaffleDrawCron(env: Bindings): Promise<void> {
  const now = new Date().toISOString();

  const rows = await env.DB.prepare(
    `SELECT e.id, e.winner_count
     FROM events e
     WHERE e.type = 'raffle'
       AND e.winner_count > 0
       AND e.archived_at IS NULL
       AND e.is_series_parent = 0
       AND e.end_at IS NOT NULL
       AND e.end_at <= ?1
       AND NOT EXISTS (SELECT 1 FROM event_raffle_winners w WHERE w.event_id = e.id)`,
  )
    .bind(now)
    .all();

  const events = (rows.results ?? []) as Array<{ id: string; winner_count: number }>;

  for (const event of events) {
    const participantRows = await env.DB.prepare(
      "SELECT user_id FROM event_participants WHERE event_id = ?1",
    )
      .bind(event.id)
      .all();

    const pool = ((participantRows.results ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    if (pool.length === 0) continue;

    const winnerCount = Math.min(event.winner_count, pool.length);
    const remaining = [...pool];
    const stmts = [];
    for (let i = 0; i < winnerCount; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO event_raffle_winners (id, event_id, user_id, drawn_at) VALUES (?1, ?2, ?3, ?4)",
        ).bind(nanoid(), event.id, remaining[idx]!, now),
      );
      remaining.splice(idx, 1);
    }

    if (stmts.length > 0) {
      stmts.push(
        env.DB.prepare(
          "UPDATE events SET signup_locked = 1, updated_at = ?1 WHERE id = ?2",
        ).bind(now, event.id),
      );
      await env.DB.batch(stmts);
    }
  }
}
