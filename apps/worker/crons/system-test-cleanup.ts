import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SYSTEM_TEST_CONTENT_MARKER, SYSTEM_TEST_USERNAME_PREFIX } from "@guild/shared/config/system-test";
import type { Bindings } from "../index";

/*
 * Server-side backstop for the admin API test console.
 *
 * Teardown there is client-driven, which leaves two holes it cannot close by
 * itself:
 *   1. Closing the tab mid-run abandons every fixture the run had created.
 *   2. Deleting a user is a soft delete (AdminService.batchDelete), so even a
 *      run that tears down cleanly leaves its two disposable `users` rows in the
 *      table permanently.
 * This job deletes both, for real.
 */

/*
 * Nothing younger than this is touched, so a run in progress is never swept out
 * from under itself. A full run takes minutes; a day is generous on purpose.
 */
const SYSTEM_TEST_RETENTION_MS = 24 * 60 * 60 * 1000;

/*
 * Child tables first: these rows reference each other, and the foreign keys are
 * RESTRICT. Every entry is a table the API test console writes to, paired with
 * the column that carries the "[systemtest]" marker.
 *
 * `invite_links` is deliberately absent — it has no name, title or note column,
 * so a leaked invite link carries no marker to match on and cannot be swept
 * here. It expires on its own via `expires_at`.
 */
const MARKED_CONTENT_TABLES: readonly (readonly [table: string, markerColumn: string])[] = [
  ["storage_items", "name"],
  ["storage_categories", "name"],
  ["storages", "name"],
  ["wiki_articles", "title"],
  ["wiki_categories", "name"],
  ["war_history", "war_name"],
  ["recurring_templates", "title"],
  ["events", "title"],
  ["announcements", "title"],
  ["gallery_items", "caption"],
  ["member_badges", "name"],
];

export type SystemTestCleanupSummary = {
  content: number;
  roles: number;
  users: number;
};

export async function runSystemTestCleanupCron(env: Bindings): Promise<SystemTestCleanupSummary> {
  const db = drizzle(env.DB);
  const cutoff = new Date(Date.now() - SYSTEM_TEST_RETENTION_MS).toISOString();
  const marker = `%${SYSTEM_TEST_CONTENT_MARKER}%`;
  /*
   * `_` is a LIKE wildcard, so the prefix has to be escaped or "systemtest_"
   * would also match a username like "systemtestX".
   */
  const usernamePattern = `${SYSTEM_TEST_USERNAME_PREFIX.replace(/_/gu, "\\_")}%`;

  let content = 0;
  for (const [table, markerColumn] of MARKED_CONTENT_TABLES) {
    const result = await db.run(
      sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(markerColumn)} LIKE ${marker} AND created_at < ${cutoff}`,
    );
    content += result.meta.changes;
  }

  // Built-in roles are never test fixtures, whatever they are called.
  const roles = await db.run(
    sql`DELETE FROM roles WHERE name LIKE ${marker} AND is_builtin = 0 AND created_at < ${cutoff}`,
  );

  /*
   * audit_log.actor_id is a RESTRICT foreign key, so rows a disposable user
   * authored (its own login, its own profile edits) block the delete below. The
   * run's summary entry is written by the real admin and is not touched.
   */
  await db.run(
    sql`DELETE FROM audit_log WHERE actor_id IN (
      SELECT id FROM users WHERE username LIKE ${usernamePattern} ESCAPE '\\' AND created_at < ${cutoff}
    )`,
  );

  /*
   * Sessions, profiles, badge assignments, onboarding state, absences, game data
   * and storage transactions all hang off users with ON DELETE CASCADE, so they
   * go with the row. Authorship columns (created_by, uploaded_by, ...) are
   * RESTRICT: if a disposable user somehow authored surviving content this throws
   * rather than deleting it, and the maintenance dispatcher logs the failure.
   */
  const users = await db.run(
    sql`DELETE FROM users WHERE username LIKE ${usernamePattern} ESCAPE '\\' AND created_at < ${cutoff}`,
  );

  return { content, roles: roles.meta.changes, users: users.meta.changes };
}
