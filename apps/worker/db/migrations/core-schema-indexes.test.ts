import { DatabaseSync } from "node:sqlite";
import { BUILTIN_ROLES, PERMISSIONS } from "@guild/shared";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import {
  classCatalog,
  inviteLinks,
  storageItems,
  systemTestArtifacts,
  systemTestRuns,
  warHistory,
} from "../schema";
import { createMigratedDatabase, schemaObjectSql } from "./migration-test-utils";

const migrated = createMigratedDatabase();
afterAll(() => migrated.close());

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
      expect(schemaObjectSql(migrated, "index", indexName), indexName).toBeTruthy();
    }

    const exactIndexSql = {
      idx_wiki_categories_parent_sort:
        "ON wiki_categories(parent_id, sort_order, name, id)",
      idx_wiki_categories_sort:
        "ON wiki_categories(sort_order, name, id)",
      idx_wiki_articles_category_archived_sort:
        "ON wiki_articles(category_id, archived_at, pinned, sort_order, updated_at, id)",
      idx_wiki_articles_archived_updated:
        "ON wiki_articles(archived_at, pinned, updated_at, id)",
    } as const;

    for (const [indexName, sql] of Object.entries(exactIndexSql)) {
      expect(schemaObjectSql(migrated, "index", indexName), indexName).toContain(sql);
    }
  });
});

describe("core schema guild-war invariants", () => {
  it("allows at most one history record for each event in Drizzle and the migrated schema", () => {
    const eventIndex = getTableConfig(warHistory).indexes
      .find((index) => index.config.name === "ux_war_history_event_id");

    expect(eventIndex?.config.unique).toBe(true);
    const historyIndexSql = schemaObjectSql(migrated, "index", "ux_war_history_event_id");
    expect(historyIndexSql).toContain("CREATE UNIQUE INDEX");
    expect(historyIndexSql).not.toMatch(/\bWHERE\b/i);
    for (const indexName of [
      "ux_war_pool_members_history_user",
      "ux_war_pool_members_event_user",
    ]) {
      expect(schemaObjectSql(migrated, "index", indexName), indexName).not.toMatch(/\bWHERE\b/i);
    }
    expect(schemaObjectSql(migrated, "index", "idx_war_history_event_id")).toBe("");
  });
});

describe("core schema class-catalog invariants", () => {
  it("enforces case-insensitive labels in Drizzle and the migrated schema", () => {
    const labelIndex = getTableConfig(classCatalog).indexes
      .find((index) => index.config.name === "ux_class_catalog_label_nocase");

    expect(labelIndex?.config.unique).toBe(true);
    expect(schemaObjectSql(migrated, "index", "ux_class_catalog_label_nocase")).toContain(
      "ON class_catalog(label COLLATE NOCASE)",
    );
  });

  it("keeps all catalog checks named and synchronized", () => {
    const checks = getTableConfig(classCatalog).checks.map((constraint) => constraint.name);

    expect(checks).toEqual(expect.arrayContaining([
      "class_catalog_color_hex",
      "class_catalog_icon_type_valid",
      "class_catalog_sort_order_nonnegative",
      "class_catalog_icon_key_consistent",
    ]));
    const ddl = schemaObjectSql(migrated, "table", "class_catalog");
    for (const name of checks) expect(ddl).toContain(`CONSTRAINT ${name} CHECK`);
  });

  it("executes the migrated catalog DDL and rejects invalid or duplicate rows", () => {
    const tableSql = schemaObjectSql(migrated, "table", "class_catalog");
    const sortIndexSql = schemaObjectSql(migrated, "index", "idx_class_catalog_sort");
    const labelIndexSql = schemaObjectSql(migrated, "index", "ux_class_catalog_label_nocase");
    expect(tableSql).toBeTruthy();
    expect(sortIndexSql).toBeTruthy();
    expect(labelIndexSql).toBeTruthy();

    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`${tableSql};\n${sortIndexSql};\n${labelIndexSql};`);
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
  it("keeps the created-at and id keyset index in Drizzle and the migrated schema", () => {
    const createdIndex = getTableConfig(inviteLinks).indexes
      .find((index) => index.config.name === "idx_invite_links_created");

    expect(createdIndex?.config.columns.map((column) => ("name" in column ? column.name : null)))
      .toEqual(["created_at", "id"]);
    expect(schemaObjectSql(migrated, "index", "idx_invite_links_created")).toContain(
      "ON invite_links(created_at, id)",
    );
  });
});

describe("core schema storage invariants", () => {
  it("keeps storage quantity nonnegative in Drizzle and the migrated schema", () => {
    const drizzleChecks = getTableConfig(storageItems).checks.map((constraint) => constraint.name);

    expect(drizzleChecks).toContain("storage_items_quantity_nonnegative");
    expect(schemaObjectSql(migrated, "table", "storage_items")).toContain(
      "CONSTRAINT storage_items_quantity_nonnegative CHECK (quantity >= 0)",
    );
  });

  it("keeps keyset pagination indexes in Drizzle and the migrated schema", () => {
    const drizzleIndexes = getTableConfig(storageItems).indexes.map((index) => index.config.name);

    expect(drizzleIndexes).toEqual(expect.arrayContaining([
      "idx_storage_items_storage_name_id",
      "idx_storage_items_storage_category_name_id",
    ]));
    expect(schemaObjectSql(migrated, "index", "idx_storage_items_storage_name_id")).toContain("ON storage_items(storage_id, name, id)");
    expect(schemaObjectSql(migrated, "index", "idx_storage_items_storage_category_name_id")).toContain("ON storage_items(storage_id, category_id, name, id)");
  });
});

describe("core schema role baseline data", () => {
  it("includes every built-in role and permission row", () => {
    for (const role of BUILTIN_ROLES) {
      expect(migrated.prepare("SELECT 1 FROM roles WHERE id = ?").get(role)).toBeTruthy();

      for (const permission of PERMISSIONS) {
        expect(migrated.prepare("SELECT 1 FROM role_permissions WHERE role_id = ? AND permission = ?").get(role, permission)).toBeTruthy();
      }
    }
  });
});

describe("core schema system-test registry", () => {
  it("keeps run and exact-artifact cleanup indexes in Drizzle and the migrated schema", () => {
    expect(getTableConfig(systemTestRuns).indexes.map((index) => index.config.name)).toContain("idx_system_test_runs_cleanup_lookup");
    expect(getTableConfig(systemTestArtifacts).indexes.map((index) => index.config.name)).toContain("idx_system_test_artifacts_run_type");
    expect(schemaObjectSql(migrated, "table", "system_test_runs")).toBeTruthy();
    expect(schemaObjectSql(migrated, "table", "system_test_artifacts")).toBeTruthy();
    const runChecks = getTableConfig(systemTestRuns).checks.map((constraint) => constraint.name);
    expect(runChecks).toContain("system_test_runs_status_valid");
    expect(runChecks).toContain("system_test_runs_active_requests_nonnegative");
    expect(schemaObjectSql(migrated, "table", "system_test_runs")).toContain(
      "CONSTRAINT system_test_runs_status_valid CHECK (status IN ('running', 'cleaning', 'cleanup_failed', 'completed', 'manual_review'))",
    );
    expect(schemaObjectSql(migrated, "table", "system_test_runs")).toContain(
      "CONSTRAINT system_test_runs_active_requests_nonnegative CHECK (active_requests >= 0)",
    );
    expect(schemaObjectSql(migrated, "index", "idx_system_test_runs_cleanup_lookup")).toBeTruthy();
    expect(schemaObjectSql(migrated, "index", "idx_system_test_artifacts_run_type")).toBeTruthy();
  });
});

describe("core schema site config data", () => {
  it("stores admin-managed policies and analytics settings in D1", () => {
    const expectedColumns = [
      "feature_flags_json TEXT NOT NULL",
      "media_policy_json TEXT NOT NULL",
      "storage_policy_json TEXT NOT NULL",
      "absence_policy_json TEXT NOT NULL",
      "analytics_settings_json TEXT NOT NULL",
    ];

    const siteConfigSql = schemaObjectSql(migrated, "table", "site_config");
    for (const column of expectedColumns) expect(siteConfigSql).toContain(column);

    expect(migrated.prepare("SELECT 1 FROM site_config WHERE id = 'default'").get()).toBeTruthy();
    for (const removedTable of [
      "site_event_types",
      "site_guild_war_results",
      "site_guild_war_team_stats",
      "site_guild_war_member_stats",
      "site_guild_war_settings",
      "site_guild_war_kda_terms",
    ]) {
      expect(schemaObjectSql(migrated, "table", removedTable)).toBe("");
    }
    expect(siteConfigSql).not.toContain("game_rules_json");
    const config = migrated.prepare("SELECT feature_flags_json, analytics_settings_json FROM site_config WHERE id = 'default'").get() as {
      feature_flags_json: string;
      analytics_settings_json: string;
    };
    expect(JSON.parse(config.analytics_settings_json)).toMatchObject({ reference_duration_minutes: 30 });
    expect(JSON.parse(config.feature_flags_json)).toMatchObject({ storage: true });
    expect(siteConfigSql).not.toContain("intake_batch");
  });
});
