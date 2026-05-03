import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import type { Bindings } from "../index";

const MAX_ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

export async function runSessionCleanupCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  const absoluteCutoff = new Date(Date.now() - MAX_ABSOLUTE_SESSION_MS).toISOString();

  const result = await db.run(
    sql`DELETE FROM sessions WHERE expires_at <= ${now} OR created_at <= ${absoluteCutoff}`,
  );

  const deleted = result.meta?.changes ?? 0;
  if (deleted > 0) {
    console.log(`[cron] session-cleanup: purged ${deleted} expired sessions`);
  }
}
