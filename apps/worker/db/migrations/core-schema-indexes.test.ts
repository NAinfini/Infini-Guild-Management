import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaSql = readFileSync("apps/worker/db/migrations/0000_core_schema.sql", "utf8");

describe("core schema performance indexes", () => {
  it("includes composite indexes for hot list and filtered lookup queries", () => {
    const expectedIndexes = [
      "idx_events_series_archived_start",
      "idx_war_history_event_created",
      "idx_audit_log_entity_created",
      "idx_audit_log_actor_created",
      "idx_wiki_categories_sort",
    ];

    for (const indexName of expectedIndexes) {
      expect(schemaSql).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
  });
});
