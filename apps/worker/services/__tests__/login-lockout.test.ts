import { describe, expect, it } from "vitest";
import { clearLoginFailures, readLockout, recordLoginFailure } from "../login-lockout";

type Row = { failCount: number; lockedUntil: string | null };

/**
 * Single-row fake DB. Every helper in login-lockout.ts scopes its statement to
 * one username, so the fake ignores the predicates and tracks that one row.
 */
function createDb(row: Row | null) {
  const state = { row: row ? { ...row } : null as Row | null, deletes: 0 };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(state.row ? [state.row] : []) }) }) }),
    insert: () => ({
      values: (values: { failCount: number }) => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            state.row = state.row
              ? { ...state.row, failCount: state.row.failCount + 1 }
              : { failCount: values.failCount, lockedUntil: null };
            return Promise.resolve([{ failCount: state.row.failCount }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: { lockedUntil: string }) => ({
        where: () => {
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
