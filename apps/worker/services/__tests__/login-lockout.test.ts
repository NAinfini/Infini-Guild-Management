import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { clearLoginFailures, readLockout, recordLoginFailure } from "../login-lockout";

type Row = { failCount: number; lockedUntil: string | null };
const dialect = new SQLiteSyncDialect();
const lockSteps = [30, 60, 300, 900, 1800, 3600] as const;

/**
 * Single-row fake DB. Every helper in login-lockout.ts scopes its statement to
 * one username, so the fake ignores the predicates and tracks that one row.
 */
function createDb(row: Row | null) {
  const state = {
    row: row ? { ...row } : null as Row | null,
    deletes: 0,
    updates: 0,
    conflictLockedUntil: null as SQL | null,
  };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(state.row ? [state.row] : []) }) }) }),
    insert: () => ({
      values: (values: { failCount: number }) => ({
        onConflictDoUpdate: (config: { set: { lockedUntil?: SQL } }) => ({
          returning: () => {
            state.conflictLockedUntil = config.set.lockedUntil ?? null;
            const failCount = state.row ? state.row.failCount + 1 : values.failCount;
            const step = failCount <= 3 ? 0 : lockSteps[Math.min(failCount - 4, lockSteps.length - 1)]!;
            const candidate = step > 0
              ? new Date(NOW.getTime() + step * 1000).toISOString()
              : null;
            const existing = state.row?.lockedUntil ?? null;
            const lockedUntil = config.set.lockedUntil && candidate && (!existing || candidate > existing)
              ? candidate
              : existing;
            state.row = { failCount, lockedUntil };
            return Promise.resolve([{ failCount, lockedUntil }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: { lockedUntil: string }) => ({
        where: () => {
          state.updates += 1;
          if (state.row) state.row.lockedUntil = patch.lockedUntil;
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        state.deletes += 1;
        return Promise.resolve();
      },
    }),
  };
  return { db: db as never, state };
}

const NOW = new Date("2026-07-25T00:00:00.000Z");

describe("login lockout ladder", () => {
  it("gives three free attempts, then escalates 30s/1m/5m/15m/30m/1h and caps at 1h", async () => {
    const { db } = createDb(null);
    const seconds: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      seconds.push((await recordLoginFailure(db, "victim", NOW)).retryAfterSeconds);
    }
    expect(seconds).toEqual([0, 0, 0, 30, 60, 300, 900, 1800, 3600, 3600]);
  });

  it("writes the lock deadline only once the free attempts are used up", async () => {
    const { db, state } = createDb(null);
    await recordLoginFailure(db, "victim", NOW);
    expect(state.row?.lockedUntil).toBeNull();
    await recordLoginFailure(db, "victim", NOW);
    await recordLoginFailure(db, "victim", NOW);
    expect(state.row?.lockedUntil).toBeNull();
    await recordLoginFailure(db, "victim", NOW);
    expect(state.row?.lockedUntil).toBe("2026-07-25T00:00:30.000Z");
  });

  it("updates the count and lock deadline in one atomic upsert", async () => {
    const { db, state } = createDb({ failCount: 3, lockedUntil: null });

    await recordLoginFailure(db, "victim", NOW);

    expect(state.updates).toBe(0);
    expect(state.conflictLockedUntil).not.toBeNull();
    const query = dialect.sqlToQuery(state.conflictLockedUntil!);
    expect(query.sql.toLowerCase()).toContain("case");
    expect(query.sql).toContain("fail_count");
  });

  it("never lets a late shorter deadline replace a longer concurrent lock", async () => {
    const { db, state } = createDb({
      failCount: 4,
      lockedUntil: "2026-07-25T01:00:00.000Z",
    });

    const result = await recordLoginFailure(db, "victim", NOW);

    expect(state.row?.lockedUntil).toBe("2026-07-25T01:00:00.000Z");
    expect(result).toEqual({ retryAfterSeconds: 3600, failCount: 5 });
  });
});

describe("readLockout", () => {
  it("reports the seconds remaining while the lock is active", async () => {
    const { db } = createDb({ failCount: 4, lockedUntil: "2026-07-25T00:00:30.000Z" });
    expect(await readLockout(db, "victim", NOW)).toEqual({ retryAfterSeconds: 30, failCount: 4 });
  });

  it("returns null once the deadline has passed, so the next password is checked", async () => {
    const { db } = createDb({ failCount: 4, lockedUntil: "2026-07-24T23:59:59.000Z" });
    expect(await readLockout(db, "victim", NOW)).toBeNull();
  });

  it("returns null while the user is still inside the free attempts", async () => {
    const { db } = createDb({ failCount: 2, lockedUntil: null });
    expect(await readLockout(db, "victim", NOW)).toBeNull();
  });

  it("returns null on an unparseable stored deadline instead of locking forever", async () => {
    const { db } = createDb({ failCount: 4, lockedUntil: "not-a-date" });
    expect(await readLockout(db, "victim", NOW)).toBeNull();
  });
});

describe("clearLoginFailures", () => {
  it("deletes the ladder row", async () => {
    const { db, state } = createDb({ failCount: 5, lockedUntil: "2026-07-25T00:01:00.000Z" });
    await clearLoginFailures(db, "victim");
    expect(state.deletes).toBe(1);
  });
});
