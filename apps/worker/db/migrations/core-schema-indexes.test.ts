import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync("apps/worker/db/migrations/0000_core_schema.sql", "utf8");

describe("core schema performance indexes", () => {
  it("includes composite indexes for hot list and filtered lookup queries", () => {
    const expectedIndexes = [
      "idx_events_archived_start",
      "idx_war_history_event_created",
      "idx_audit_log_entity_created",
      "idx_audit_log_actor_created",
      "idx_wiki_categories_sort",
      "idx_storage_transactions_item",
      "idx_storage_transactions_recipient",
      "idx_storage_transactions_created",
    ];

    for (const indexName of expectedIndexes) {
      expect(schemaSql).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
  });
});
