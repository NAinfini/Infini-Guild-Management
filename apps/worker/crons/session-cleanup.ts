import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import type { Bindings } from "../index";

const MAX_ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

export async function runSessionCleanupCron(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  const absoluteCutoff = new Date(Date.now() - MAX_ABSOLUTE_SESSION_MS).toISOString();

  await db.run(
    sql`DELETE FROM sessions WHERE expires_at <= ${now} OR created_at <= ${absoluteCutoff}`,
  );
}
