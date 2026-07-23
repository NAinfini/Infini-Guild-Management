import { readFileSync } from "node:fs";
import { BUILTIN_ROLES, PERMISSIONS } from "@guild/shared";
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

describe("core schema role baseline data", () => {
  it("includes every built-in role and permission row", () => {
    for (const role of BUILTIN_ROLES) {
      expect(schemaSql).toContain(`('${role}',`);

      for (const permission of PERMISSIONS) {
        expect(schemaSql).toContain(`('${role}', '${permission}',`);
      }
    }
  });
});

describe("core schema onboarding baseline data", () => {
  it("seeds the default onboarding config disabled by default", () => {
    expect(schemaSql).toContain("INSERT OR IGNORE INTO onboarding_config");
    expect(schemaSql).toContain("'Member onboarding'");
    expect(schemaSql).toContain("Welcome to the guild");
    expect(schemaSql).toContain("NULL,");
  });
});

describe("core schema site config baseline data", () => {
  it("stores admin-managed policies and analytics settings in D1", () => {
    const expectedColumns = [
      "feature_flags_json TEXT NOT NULL",
      "media_policy_json TEXT NOT NULL",
      "storage_policy_json TEXT NOT NULL",
      "absence_policy_json TEXT NOT NULL",
      "analytics_settings_json TEXT NOT NULL",
    ];

    for (const column of expectedColumns) {
      expect(schemaSql).toContain(column);
    }

    expect(schemaSql).toContain("INSERT OR IGNORE INTO site_config");
    expect(schemaSql).toContain('"reference_duration_minutes":30');
    expect(schemaSql).toContain('"storage":true');
    expect(schemaSql).not.toContain("intake_batch");
  });
});
