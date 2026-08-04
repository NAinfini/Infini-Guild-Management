import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { BUILTIN_ROLES, PERMISSIONS } from "@guild/shared";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  classCatalog,
  inviteLinks,
  storageItems,
  systemTestArtifacts,
  systemTestRuns,
  warHistory,
} from "../schema";

const schemaSql = readFileSync("apps/worker/db/migrations/0000_core_schema.sql", "utf8");

describe("core schema performance indexes", () => {
  it("includes composite indexes for hot list and filtered lookup queries", () => {
    const expectedIndexes = [
      "idx_events_archived_start",
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

describe("core schema guild-war invariants", () => {
  it("allows at most one history record for each event in Drizzle and baseline SQL", () => {
    const eventIndex = getTableConfig(warHistory).indexes
      .find((index) => index.config.name === "ux_war_history_event_id");

    expect(eventIndex?.config.unique).toBe(true);
    expect(schemaSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_war_history_event_id",
    );
    expect(schemaSql).not.toContain(
      "CREATE INDEX IF NOT EXISTS idx_war_history_event_id",
    );
  });
});

describe("core schema class-catalog invariants", () => {
  it("enforces case-insensitive labels in Drizzle and baseline SQL", () => {
    const labelIndex = getTableConfig(classCatalog).indexes
      .find((index) => index.config.name === "ux_class_catalog_label_nocase");

    expect(labelIndex?.config.unique).toBe(true);
    expect(schemaSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_class_catalog_label_nocase",
    );
    expect(schemaSql).toContain("ON class_catalog(label COLLATE NOCASE)");
  });

  it("keeps all catalog checks named and synchronized", () => {
    const checks = getTableConfig(classCatalog).checks.map((constraint) => constraint.name);

    expect(checks).toEqual(expect.arrayContaining([
      "class_catalog_color_hex",
      "class_catalog_icon_type_valid",
      "class_catalog_sort_order_nonnegative",
      "class_catalog_icon_key_consistent",
    ]));
    for (const name of checks) {
      expect(schemaSql).toContain(`CONSTRAINT ${name} CHECK`);
    }
  });

  it("executes the baseline catalog DDL and rejects invalid or duplicate rows", () => {
    const tableSql = schemaSql.match(
      /CREATE TABLE IF NOT EXISTS class_catalog \([\s\S]*?\n\);/,
    )?.[0];
    const sortIndexSql = schemaSql.match(
      /CREATE INDEX IF NOT EXISTS idx_class_catalog_sort[\s\S]*?;/,
    )?.[0];
    const labelIndexSql = schemaSql.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_class_catalog_label_nocase[\s\S]*?;/,
    )?.[0];
    expect(tableSql).toBeTruthy();
    expect(sortIndexSql).toBeTruthy();
    expect(labelIndexSql).toBeTruthy();

    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`${tableSql}\n${sortIndexSql}\n${labelIndexSql}`);
      const insert = sqlite.prepare(
        `INSERT INTO class_catalog
          (id, label, color, icon_type, vector_icon, icon_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run("warden", "Warden", "#61B8AA", "vector", "shield", null, 10);

      expect(() => {
        insert.run("warden-2", "warden", "#112233", "vector", "shield", null, 20);
      }).toThrow(/UNIQUE constraint failed/i);
      expect(() => {
        insert.run("bad-color", "Bad Color", "#GGGGGG", "vector", "shield", null, 20);
      }).toThrow(/class_catalog_color_hex/i);
      expect(() => {
        insert.run("bad-key", "Bad Key", "#112233", "vector", "shield", "orphan.webp", 20);
      }).toThrow(/class_catalog_icon_key_consistent/i);
    } finally {
      sqlite.close();
    }
  });
});

describe("core schema invite pagination", () => {
  it("keeps the created-at and id keyset index in Drizzle and baseline SQL", () => {
    const createdIndex = getTableConfig(inviteLinks).indexes
      .find((index) => index.config.name === "idx_invite_links_created");

    expect(createdIndex?.config.columns.map((column) => ("name" in column ? column.name : null)))
      .toEqual(["created_at", "id"]);
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_invite_links_created");
    expect(schemaSql).toContain("ON invite_links(created_at, id);");
  });
});

describe("core schema storage invariants", () => {
  it("keeps storage quantity nonnegative in Drizzle and the baseline SQL", () => {
    const drizzleChecks = getTableConfig(storageItems).checks.map((constraint) => constraint.name);

    expect(drizzleChecks).toContain("storage_items_quantity_nonnegative");
    expect(schemaSql).toContain("CONSTRAINT storage_items_quantity_nonnegative CHECK (quantity >= 0)");
  });

  it("keeps keyset pagination indexes in Drizzle and the baseline SQL", () => {
    const drizzleIndexes = getTableConfig(storageItems).indexes.map((index) => index.config.name);

    expect(drizzleIndexes).toEqual(expect.arrayContaining([
      "idx_storage_items_storage_name_id",
      "idx_storage_items_storage_category_name_id",
    ]));
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_storage_items_storage_name_id ON storage_items(storage_id, name, id)");
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_storage_items_storage_category_name_id ON storage_items(storage_id, category_id, name, id)");
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

describe("core schema system-test registry", () => {
  it("keeps run and exact-artifact cleanup indexes in Drizzle and baseline SQL", () => {
    expect(getTableConfig(systemTestRuns).indexes.map((index) => index.config.name)).toContain("idx_system_test_runs_cleanup_lookup");
    expect(getTableConfig(systemTestArtifacts).indexes.map((index) => index.config.name)).toContain("idx_system_test_artifacts_run_type");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS system_test_runs");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS system_test_artifacts");
    const runChecks = getTableConfig(systemTestRuns).checks.map((constraint) => constraint.name);
    expect(runChecks).toContain("system_test_runs_status_valid");
    expect(runChecks).toContain("system_test_runs_active_requests_nonnegative");
    expect(schemaSql).toContain(
      "CONSTRAINT system_test_runs_status_valid CHECK (status IN ('running', 'cleaning', 'cleanup_failed', 'completed', 'manual_review'))",
    );
    expect(schemaSql).toContain(
      "CONSTRAINT system_test_runs_active_requests_nonnegative CHECK (active_requests >= 0)",
    );
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_system_test_runs_cleanup_lookup");
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_system_test_artifacts_run_type");
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
    for (const removedTable of [
      "site_event_types",
      "site_guild_war_results",
      "site_guild_war_team_stats",
      "site_guild_war_member_stats",
      "site_guild_war_settings",
      "site_guild_war_kda_terms",
    ]) {
      expect(schemaSql).not.toContain(removedTable);
    }
    expect(schemaSql).not.toContain("game_rules_json");
    expect(schemaSql).toContain('"reference_duration_minutes":30');
    expect(schemaSql).toContain('"storage":true');
    expect(schemaSql).not.toContain("intake_batch");
  });
});
