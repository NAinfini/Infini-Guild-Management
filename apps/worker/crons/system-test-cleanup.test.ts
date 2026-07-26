import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: SQL[] = [];

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({
    run: vi.fn(async (query: SQL) => {
      executed.push(query);
      return { meta: { changes: 1 } };
    }),
  })),
}));

import { runSystemTestCleanupCron } from "./system-test-cleanup";

const dialect = new SQLiteSyncDialect();
const statements = () => executed.map((q) => dialect.sqlToQuery(q));

function statementFor(fragment: string) {
  const found = statements().find((s) => s.sql.includes(fragment));
  if (!found) throw new Error(`no statement matched ${fragment}\n${statements().map((s) => s.sql).join("\n")}`);
  return found;
}

beforeEach(() => {
  executed.length = 0;
  // A failed assertion must not leave a frozen clock behind for the next test.
  vi.useRealTimers();
});

async function run() {
  return runSystemTestCleanupCron({ DB: {} } as never);
}

describe("system test cleanup cron", () => {
  it("escapes the underscore so the prefix cannot match unrelated usernames", async () => {
    await run();
    const usersDelete = statementFor("DELETE FROM users");
    expect(usersDelete.sql).toContain("ESCAPE '\\'");
    expect(usersDelete.params).toContain("systemtest\\_%");
  });

  it("clears audit rows authored by disposable users before deleting them", async () => {
    await run();
    const order = statements().map((s) => s.sql);
    const auditIndex = order.findIndex((s) => s.includes("DELETE FROM audit_log"));
    const usersIndex = order.findIndex((s) => s.includes("DELETE FROM users"));
    expect(auditIndex).toBeGreaterThanOrEqual(0);
    /*
     * audit_log.actor_id is a RESTRICT foreign key, so reversing these two makes
     * every user delete fail once the disposable account has logged in even once.
     */
    expect(auditIndex).toBeLessThan(usersIndex);
  });

  it("deletes storage fixtures child-first so restrict constraints hold", async () => {
    await run();
    const order = statements().map((s) => s.sql);
    const at = (table: string) => order.findIndex((s) => s.includes(`DELETE FROM ${table}`));
    expect(at("storage_items")).toBeLessThan(at("storage_categories"));
    expect(at("storage_categories")).toBeLessThan(at("storages"));
    expect(at("wiki_articles")).toBeLessThan(at("wiki_categories"));
  });

  it("never deletes a built-in role", async () => {
    await run();
    expect(statementFor("DELETE FROM roles").sql).toContain("is_builtin = 0");
  });

  it("leaves anything newer than the retention window alone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
    await run();
    for (const statement of statements()) {
      expect(statement.sql).toContain("created_at < ?");
      expect(statement.params).toContain("2026-07-25T12:00:00.000Z");
    }
  });

  it("reports how much it deleted instead of failing silently", async () => {
    const summary = await run();
    expect(summary.users).toBe(1);
    expect(summary.roles).toBe(1);
    expect(summary.content).toBeGreaterThan(1);
  });
});
