import { DatabaseSync } from "node:sqlite";
import { PERMISSIONS } from "@guild/shared";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import {
  classCatalog,
  inviteLinks,
  memberAvailabilityWindows,
  recurringTemplateWeekdays,
  storageBatches,
  storageCategories,
  storageItems,
  storageTransactions,
  systemTestArtifacts,
  systemTestRuns,
  warHistory,
  warTeamMembers,
  warTeams,
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
      "idx_storage_transactions_actor",
      "idx_storage_batches_actor_created",
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

  it("indexes the leading child column of every foreign key", () => {
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const tables = migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    const missing: string[] = [];

    for (const { name: tableName } of tables) {
      const foreignKeys = migrated.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`).all() as Array<{
        id: number;
        seq: number;
        from: string;
      }>;
      const leadingChildColumns = foreignKeys
        .filter((foreignKey) => foreignKey.seq === 0)
        .map((foreignKey) => foreignKey.from);
      const indexes = migrated.prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`).all() as Array<{
        name: string;
      }>;
      const indexColumns = indexes.map(({ name }) =>
        (migrated.prepare(`PRAGMA index_info(${quoteIdentifier(name)})`).all() as Array<{
          seqno: number;
          name: string | null;
        }>)
          .sort((left, right) => left.seqno - right.seqno)
          .map((column) => column.name),
      );

      for (const childColumn of leadingChildColumns) {
        const covered = indexColumns.some((columns) => columns[0] === childColumn);
        if (!covered) missing.push(`${tableName}(${childColumn})`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("includes the explicit actor, editor, and user foreign-key indexes", () => {
    const names = [
      "idx_announcements_created_by",
      "idx_announcements_updated_by",
      "idx_event_poll_votes_user",
      "idx_event_raffle_winners_user",
      "idx_events_updated_by",
      "idx_invite_links_created_by",
      "idx_invite_links_role_id",
      "idx_member_badge_assignments_assigned_by",
      "idx_recurring_templates_created_by",
      "idx_system_test_runs_actor",
      "idx_war_history_created_by",
      "idx_war_history_updated_by",
      "idx_war_pool_members_user",
      "idx_wiki_articles_created_by",
      "idx_wiki_articles_updated_by",
      "idx_wiki_revisions_edited_by",
    ];
    for (const name of names) expect(schemaObjectSql(migrated, "index", name), name).toBeTruthy();
  });

  it("keeps normalized history and member-stat reads on the existing join indexes", () => {
    expect(getTableConfig(warHistory).indexes.map((index) => index.config.name))
      .toContain("idx_war_history_created");
    expect(getTableConfig(warTeams).indexes.map((index) => index.config.name))
      .toContain("idx_war_teams_history_sort");
    expect(getTableConfig(warTeamMembers).indexes.map((index) => index.config.name))
      .toEqual(expect.arrayContaining([
        "idx_war_team_members_team_sort",
        "idx_war_team_members_user",
      ]));

    for (const indexName of [
      "idx_war_history_created",
      "idx_war_teams_history_sort",
      "idx_war_team_members_team_sort",
      "idx_war_team_members_user",
    ]) {
      expect(schemaObjectSql(migrated, "index", indexName), indexName).toBeTruthy();
    }
  });
});

describe("core schema normalized schedule indexes", () => {
  it("indexes normalized availability and weekly recurrence lookups in both schema sources", () => {
    const expected = [
      [
        memberAvailabilityWindows,
        "member_availability_windows",
        "idx_member_availability_windows_lookup",
        ["weekday", "start_minute", "end_minute", "user_id"],
      ],
      [
        recurringTemplateWeekdays,
        "recurring_template_weekdays",
        "idx_recurring_template_weekdays_weekday_template",
        ["weekday", "template_id"],
      ],
    ] as const;

    for (const [table, tableName, indexName, columns] of expected) {
      const drizzleIndex = getTableConfig(table).indexes.find((index) => index.config.name === indexName);
      expect(drizzleIndex?.config.columns.map((column) => ("name" in column ? column.name : null)))
        .toEqual(columns);
      expect(schemaObjectSql(migrated, "index", indexName)).toContain(
        `ON ${tableName}(${columns.join(", ")})`,
      );
    }
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
      "class_catalog_icon_source_consistent",
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
          (id, label, color, icon_type, vector_icon, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insert.run("warden", "Warden", "#61B8AA", "vector", "shield", 10);
      insert.run("oracle", "Oracle", "#112233", "image", null, 20);

      expect(() => {
        insert.run("warden-2", "warden", "#112233", "vector", "shield", 30);
      }).toThrow(/UNIQUE constraint failed/i);
      expect(() => {
        insert.run("bad-color", "Bad Color", "#GGGGGG", "vector", "shield", 30);
      }).toThrow(/class_catalog_color_hex/i);
      expect(() => {
        insert.run("bad-vector", "Bad Vector", "#112233", "vector", null, 30);
      }).toThrow(/class_catalog_icon_source_consistent/i);
      expect(() => {
        insert.run("bad-image", "Bad Image", "#112233", "image", "shield", 30);
      }).toThrow(/class_catalog_icon_source_consistent/i);
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

  it("keeps normalized batch and category keys unique in both schema sources", () => {
    const expected = [
      [storageCategories, "storage_categories", "ux_storage_categories_storage_id", ["storage_id", "id"]],
      [storageBatches, "storage_batches", "ux_storage_batches_id_actor", ["id", "actor_id"]],
      [storageTransactions, "storage_transactions", "ux_storage_transactions_batch_position", ["batch_id", "batch_position"]],
      [storageTransactions, "storage_transactions", "ux_storage_transactions_batch_item", ["batch_id", "item_id"]],
    ] as const;

    for (const [table, tableName, indexName, columns] of expected) {
      const drizzleIndex = getTableConfig(table).indexes.find((index) => index.config.name === indexName);
      expect(drizzleIndex?.config.unique).toBe(true);
      expect(drizzleIndex?.config.columns.map((column) => ("name" in column ? column.name : null)))
        .toEqual(columns);
      expect(schemaObjectSql(migrated, "index", indexName)).toContain(
        `ON ${tableName}(${columns.join(", ")})`,
      );
    }
  });
});

describe("core schema role baseline data", () => {
  it("stores only granted permission rows", () => {
    const moderator = [
      "admin.users.view", "admin.users.edit", "admin.invite.view", "admin.audit.view",
      "admin.status.view", "admin.roles.view", "admin.analytics.view", "guildwar.teams.edit",
      "guildwar.history.edit", "events.create", "events.edit", "events.archive", "events.delete",
      "events.templates", "announcements.create", "announcements.edit", "announcements.archive",
      "announcements.delete", "gallery.upload", "gallery.manage", "gallery.delete",
      "wiki.articles.create", "wiki.articles.edit", "wiki.articles.archive",
      "wiki.articles.delete", "wiki.categories.manage",
    ];
    const expected = new Map<string, readonly string[]>([
      ["admin", PERMISSIONS],
      ["moderator", moderator],
      ["member", ["gallery.upload"]],
    ]);

    for (const [role, permissions] of expected) {
      expect(migrated.prepare("SELECT 1 FROM roles WHERE id = ?").get(role)).toBeTruthy();
      expect(migrated.prepare(
        "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission",
      ).all(role).map((row) => (row as { permission: string }).permission)).toEqual([...permissions].sort());
    }
    expect((migrated.prepare("PRAGMA table_info(role_permissions)").all() as Array<{ name: string }>)
      .map((column) => column.name)).toEqual(["role_id", "permission"]);
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
  it("seeds the complete authoritative relational singleton", () => {
    const expectedColumns = [
      "feature_announcements_enabled INTEGER NOT NULL",
      "feature_storage_enabled INTEGER NOT NULL",
      "media_site_logo_max_bytes INTEGER NOT NULL",
      "media_class_icon_max_bytes INTEGER NOT NULL",
      "media_profile_quota INTEGER NOT NULL",
      "storage_images_per_item INTEGER NOT NULL",
      "absence_max_span_days INTEGER NOT NULL",
      "analytics_reference_duration_minutes REAL NOT NULL",
      "analytics_kills_weight REAL NOT NULL",
      "analytics_distance_weight REAL NOT NULL",
    ];

    const siteConfigSql = schemaObjectSql(migrated, "table", "site_config");
    for (const column of expectedColumns) expect(siteConfigSql).toContain(column);

    expect(migrated.prepare(
      `SELECT id, site_name, feature_announcements_enabled, feature_storage_enabled,
        media_site_logo_max_bytes, media_class_icon_max_bytes, media_gallery_quota,
        storage_images_per_item, absence_max_span_days, absence_max_entries_per_user,
        analytics_reference_duration_minutes, analytics_kills_weight, analytics_towers_weight,
        analytics_base_hp_weight, analytics_credits_weight, analytics_distance_weight
       FROM site_config`,
    ).get()).toEqual({
      id: "default",
      site_name: "Infini Guild",
      feature_announcements_enabled: 1,
      feature_storage_enabled: 1,
      media_site_logo_max_bytes: 2 * 1024 * 1024,
      media_class_icon_max_bytes: 512 * 1024,
      media_gallery_quota: 20,
      storage_images_per_item: 5,
      absence_max_span_days: 366,
      absence_max_entries_per_user: 20,
      analytics_reference_duration_minutes: 30,
      analytics_kills_weight: 0.3,
      analytics_towers_weight: 0.1,
      analytics_base_hp_weight: 0.15,
      analytics_credits_weight: 0.3,
      analytics_distance_weight: 0.15,
    });
    expect(migrated.prepare("PRAGMA index_list(site_config)").all()).toEqual([
      expect.objectContaining({ name: "sqlite_autoindex_site_config_1", origin: "pk", unique: 1 }),
    ]);
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
    expect(siteConfigSql).not.toContain("site_logo_url");
    expect(siteConfigSql).not.toContain("intake_batch");
    expect(siteConfigSql).not.toMatch(/\b(feature_flags_json|media_policy_json|storage_policy_json|absence_policy_json|analytics_settings_json)\b/);
  });
});
