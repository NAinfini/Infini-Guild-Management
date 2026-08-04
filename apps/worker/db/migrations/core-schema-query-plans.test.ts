import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migration-test-utils";

describe("core schema query plans", () => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
  });

  afterAll(() => db.close());

  function plan(sql: string, ...bindings: Array<string | number>): string {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings)
      .map((row) => String((row as { detail?: unknown }).detail ?? ""))
      .join("\n");
  }

  function expectStableIndex(queryPlan: string, indexName: string) {
    expect(queryPlan).toContain(indexName);
    expect(queryPlan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/i);
  }

  it("covers stable audit lists for unfiltered, entity+actor, entity, and actor paths", () => {
    const tail = "created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 50";
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE ${tail}`, "2026-01-01", "2026-12-31"), "idx_audit_log_created_at");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE entity_type = ? AND actor_id = ? AND ${tail}`, "event", "u", "2026-01-01", "2026-12-31"), "idx_audit_log_entity_actor_created");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE entity_type = ? AND ${tail}`, "event", "2026-01-01", "2026-12-31"), "idx_audit_log_entity_created");
    expectStableIndex(plan(`SELECT * FROM audit_log WHERE actor_id = ? AND ${tail}`, "u", "2026-01-01", "2026-12-31"), "idx_audit_log_actor_created");
  });

  it("covers stable error lists with and without a source filter", () => {
    expectStableIndex(plan("SELECT * FROM error_log ORDER BY created_at DESC, id DESC LIMIT 50"), "idx_error_log_created_at");
    expectStableIndex(plan("SELECT * FROM error_log WHERE source = ? ORDER BY created_at DESC, id DESC LIMIT 50", "request"), "idx_error_log_source_created");
  });

  it("covers stable storage ledger lists on every supported filter path", () => {
    expectStableIndex(plan("SELECT * FROM storage_transactions ORDER BY created_at DESC, id DESC LIMIT 50"), "idx_storage_transactions_created");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", "item"), "idx_storage_transactions_item");
    expectStableIndex(plan("SELECT * FROM storage_transactions WHERE recipient_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", "user"), "idx_storage_transactions_recipient");
  });
});
