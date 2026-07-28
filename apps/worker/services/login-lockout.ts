import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { loginFailures } from "../db/schema";

// The widest of the two schema generics used across services, so both
// AuthService (`Record<string, never>`) and AdminService (`ReturnType<typeof
// drizzle>`) can pass their handle in without a cast.
type DrizzleDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * Progressive login lockout.
 *
 * The first `FREE_ATTEMPTS` failures cost nothing — typos should not lock
 * anyone out. After that each further failure escalates through
 * `LOCK_STEPS_SECONDS`, capped at the last step. A correct password clears the
 * row outright, so the ladder only ever punishes a run of consecutive failures.
 *
 * These are compile-time constants on purpose. They are NOT site config: the
 * `admin.siteConfig.manage` permission is separate from the auth permissions,
 * so a runtime knob here would let a site-config editor set the lockout to zero
 * and switch off brute-force protection without ever touching a user record.
 *
 * Known trade-off: any account-level lockout can be used to lock a known
 * username out on purpose. `AdminService.resetLoginLock` is the escape hatch.
 */
const FREE_ATTEMPTS = 3;
const LOCK_STEPS_SECONDS = [30, 60, 300, 900, 1800, 3600] as const;

/** Rows older than this with no active lock are pruned; bounds table growth. */
const STALE_ROW_MS = 24 * 60 * 60 * 1000;

export type LockoutState = {
  /** Seconds remaining, > 0 only while the lock is active. */
  retryAfterSeconds: number;
  failCount: number;
};

function lockSecondsFor(failCount: number): number {
  if (failCount <= FREE_ATTEMPTS) return 0;
  const index = Math.min(failCount - FREE_ATTEMPTS - 1, LOCK_STEPS_SECONDS.length - 1);
  return LOCK_STEPS_SECONDS[index]!;
}

/**
 * Current lock state for an attempted username. Returns null when not locked.
 * Called before the password is checked, so a locked account never spends CPU
 * on key derivation.
 */
export async function readLockout(db: DrizzleDb, username: string, now: Date): Promise<LockoutState | null> {
  const row = (
    await db
      .select({ failCount: loginFailures.failCount, lockedUntil: loginFailures.lockedUntil })
      .from(loginFailures)
      .where(eq(loginFailures.username, username))
      .limit(1)
  )[0];
  if (!row?.lockedUntil) return null;

  const lockedUntilMs = Date.parse(row.lockedUntil);
  if (!Number.isFinite(lockedUntilMs)) return null;
  const remainingMs = lockedUntilMs - now.getTime();
  if (remainingMs <= 0) return null;

  return { retryAfterSeconds: Math.ceil(remainingMs / 1000), failCount: row.failCount };
}

/**
 * Records one failed attempt and returns the resulting lock state.
 * `failCount` is incremented in SQL so concurrent attempts cannot both read the
 * same count and overwrite each other with the same value.
 */
export async function recordLoginFailure(db: DrizzleDb, username: string, now: Date): Promise<LockoutState> {
  const nowIso = now.toISOString();
  const [row] = await db
    .insert(loginFailures)
    .values({ username, failCount: 1, lockedUntil: null, lastFailedAt: nowIso })
    .onConflictDoUpdate({
      target: loginFailures.username,
      set: {
        failCount: sql`${loginFailures.failCount} + 1`,
        lastFailedAt: nowIso,
      },
    })
    .returning({ failCount: loginFailures.failCount });

  const failCount = row?.failCount ?? 1;
  const lockSeconds = lockSecondsFor(failCount);
  if (lockSeconds > 0) {
    const lockedUntil = new Date(now.getTime() + lockSeconds * 1000).toISOString();
    await db.update(loginFailures).set({ lockedUntil }).where(eq(loginFailures.username, username));
  }

  await pruneStaleLoginFailures(db, now);
  return { retryAfterSeconds: lockSeconds, failCount };
}

/** Clears the ladder. Called on a successful password check and by admin reset. */
export async function clearLoginFailures(db: DrizzleDb, username: string): Promise<void> {
  await db.delete(loginFailures).where(eq(loginFailures.username, username));
}

/**
 * Drops rows that have been idle for a day and are not currently locked.
 * Without this the table grows without bound, because rows are created for
 * arbitrary attacker-supplied usernames.
 */
export async function pruneStaleLoginFailures(db: DrizzleDb, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_ROW_MS).toISOString();
  await db
    .delete(loginFailures)
    .where(
      and(
        lt(loginFailures.lastFailedAt, cutoff),
        or(isNull(loginFailures.lockedUntil), lt(loginFailures.lockedUntil, now.toISOString())),
      ),
    );
}
