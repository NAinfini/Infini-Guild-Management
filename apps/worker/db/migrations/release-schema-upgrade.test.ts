import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigration,
  applyMigrations,
  migrationDirectory,
  migrationFiles,
  schemaObjectSql,
} from "./migration-test-utils";

type Row = Record<string, unknown>;

const baselineSql = readFileSync(`${migrationDirectory}/0000_core_schema.sql`, "utf8");
const upgradeSql = readFileSync(
  `${migrationDirectory}/0001_release_schema_upgrade.sql`,
  "utf8",
);

const protectedTables = [
  "game_data",
  "onboarding_config",
  "member_onboarding_state",
] as const;

const newTables = [
  "class_catalog",
  "class_tags",
  "class_tag_members",
  "event_attachments",
  "event_class_quotas",
  "login_failures",
  "media_reference_backfills",
  "media_upload_leases",
  "member_profile_images",
  "recurring_template_attachments",
  "recurring_template_class_quotas",
  "system_test_runs",
  "system_test_artifacts",
] as const;

function rows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return rows(db, `PRAGMA table_info(${table})`).map((row) => String(row.name));
}

function tableNames(db: DatabaseSync): Set<string> {
  return new Set(
    rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => String(row.name)),
  );
}

function createBaselineDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  applyMigration(sqlite, baselineSql);
  return sqlite;
}

function insertUser(
  db: DatabaseSync,
  id: string,
  username: string,
  role = "member",
): void {
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)")
    .run(id, username, role);
}

function protectedSnapshot(db: DatabaseSync): Record<string, {
  ddl: string;
  rows: Row[];
}> {
  return Object.fromEntries(protectedTables.map((table) => [
    table,
    {
      ddl: schemaObjectSql(db, "table", table),
      rows: rows(db, `SELECT * FROM ${table} ORDER BY 1`),
    },
  ]));
}

describe("release schema upgrade", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("upgrades the production-shaped baseline without losing legacy data", () => {
    expect(migrationFiles).toEqual([
      "0000_core_schema.sql",
      "0001_release_schema_upgrade.sql",
      "0002_dynamic_role_authority.sql",
    ]);

    db = createBaselineDatabase();
    db.prepare(
      "INSERT INTO roles (id, name, level, is_builtin) VALUES (?, ?, ?, ?)",
    ).run("raider", "Raider", 200, 0);
    db.prepare(
      "INSERT INTO role_permissions (role_id, permission, granted) VALUES (?, ?, ?)",
    ).run("raider", "events.create", 1);
    insertUser(db, "user-1", "Legacy-One", "raider");
    insertUser(db, "user-2", "Legacy-Two");

    db.prepare(
      "INSERT INTO game_data (data, version, uploaded_by) VALUES (?, ?, ?)",
    ).run('{"classes":["legacy"]}', "prod-v1", "user-1");
    db.prepare(
      `INSERT INTO onboarding_config
        (id, title, body_json, checklist_json, require_ack, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("custom", "Custom onboarding", '{"type":"doc"}', "[]", 1, "user-1");
    db.prepare(
      `INSERT INTO member_onboarding_state
        (user_id, completed_item_ids_json, acknowledged_at)
       VALUES (?, ?, ?)`,
    ).run("user-1", '["read-rules"]', "2026-08-01T00:00:00.000Z");

    db.prepare(
      `INSERT INTO member_profiles
        (id, user_id, power, classes, avatar_key, images, audio_key,
         video_urls, availability, vacation_start, vacation_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "profile-1",
      "user-1",
      123.5,
      '["鸣金虹","牵丝霖","鸣金虹"]',
      "members/user-1/avatar.webp",
      '["members/user-1/images/a.webp","members/user-1/images/b.webp","members/user-1/images/a.webp"]',
      "members/user-1/audio.opus",
      "[]",
      '{"monday":true}',
      "2026-08-10",
      "2026-08-12",
    );
    db.prepare(
      `INSERT INTO member_profiles
        (id, user_id, classes, images, video_urls, availability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("profile-2", "user-2", "[]", "[]", "[]", "{}");
    db.prepare(
      "INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)",
    ).run("user-2", "鸣金虹");
    db.prepare(
      "INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)",
    ).run("user-2", "裂石威");

    db.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "event-poll",
      "poll",
      "Legacy poll",
      "2026-08-10T00:00:00.000Z",
      "user-1",
      '["events/event-poll/images/a.webp","events/event-poll/images/a.webp"]',
    );
    db.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "event-war",
      "guild_war",
      "Legacy war",
      "2026-08-11T00:00:00.000Z",
      "user-1",
      "[]",
    );
    db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_rule, attachments,
         timezone_offset_minutes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "template-1",
      "social",
      "Legacy recurring",
      "20:00",
      '{"frequency":"weekly"}',
      '["events/template-1/images/a.webp"]',
      480,
      "user-1",
    );
    db.prepare(
      "INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)",
    ).run("participant-1", "event-poll", "user-2");
    db.prepare("INSERT INTO event_polls (event_id) VALUES (?)").run("event-poll");
    db.prepare(
      "INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, ?)",
    ).run("option-1", "event-poll", "A");
    db.prepare(
      `INSERT INTO event_poll_votes
        (id, event_id, option_id, user_id) VALUES (?, ?, ?, ?)`,
    ).run("vote-1", "event-poll", "option-1", "user-2");
    db.prepare(
      `INSERT INTO event_raffle_winners
        (id, event_id, user_id) VALUES (?, ?, ?)`,
    ).run("winner-1", "event-poll", "user-2");
    db.prepare(
      `INSERT INTO war_history
        (id, event_id, war_name, own_stats, enemy_stats, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "history-1",
      "event-war",
      "Legacy history",
      '{"kills":5}',
      '{"kills":4}',
      "user-1",
    );
    db.prepare(
      "INSERT INTO war_teams (id, war_history_id, team_name) VALUES (?, ?, ?)",
    ).run("team-1", "history-1", "Alpha");
    db.prepare(
      `INSERT INTO war_team_members
        (id, war_team_id, user_id, stats) VALUES (?, ?, ?, ?)`,
    ).run("team-member-1", "team-1", "user-1", '{"kills":5}');
    db.prepare(
      `INSERT INTO war_pool_members
        (id, event_id, user_id) VALUES (?, ?, ?)`,
    ).run("pool-1", "event-war", "user-2");

    db.prepare(
      `INSERT INTO announcements
        (id, title, body_json, created_by) VALUES (?, ?, ?, ?)`,
    ).run(
      "announcement-1",
      "Legacy",
      '{"type":"doc","src":"announcement/announcement-1/images/a.webp"}',
      "user-1",
    );
    db.prepare(
      "INSERT INTO wiki_categories (id, name, slug) VALUES (?, ?, ?)",
    ).run("category-1", "Root", "root");
    db.prepare(
      `INSERT INTO wiki_categories
        (id, name, slug, parent_id) VALUES (?, ?, ?, ?)`,
    ).run("category-2", "Child", "child", "category-1");
    db.prepare(
      `INSERT INTO wiki_articles
        (id, title, slug, category_id, body_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "article-1",
      "Legacy",
      "legacy",
      "category-2",
      '{"type":"doc","src":"wiki/article-1/images/a.webp"}',
      "user-1",
    );
    db.prepare(
      `INSERT INTO wiki_revisions
        (id, article_id, revision, title, body_json, edited_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "revision-1",
      "article-1",
      1,
      "Legacy",
      '{"type":"doc","content":[]}',
      "user-1",
    );

    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?)")
      .run("storage-1", "Legacy storage");
    db.prepare(
      `INSERT INTO storage_items
        (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)`,
    ).run("item-1", "storage-1", "Potion", 4);
    db.prepare(
      `INSERT INTO storage_item_images
        (id, item_id, r2_key) VALUES (?, ?, ?)`,
    ).run("storage-image-1", "item-1", "storage/items/item-1/images/a.webp");
    db.prepare(
      `INSERT INTO storage_transactions
        (id, item_id, type, quantity_delta, actor_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("transaction-1", "item-1", "intake", 4, "user-1");
    db.prepare(
      `INSERT INTO gallery_items
        (id, type, url, uploaded_by) VALUES (?, ?, ?, ?)`,
    ).run("gallery-1", "image", "gallery/gallery-1/image.webp", "user-1");
    db.prepare(
      `INSERT INTO media_references
        (media_key, entity_type, entity_id) VALUES (?, ?, ?)`,
    ).run("existing/key.webp", "gallery_item", "existing");
    db.prepare(
      `UPDATE site_config SET analytics_settings_json = ?
       WHERE id = 'default'`,
    ).run(
      '{"reference_duration_minutes":30,"modifier_weights":{"credits":0.3,"kda":0.45,"basehp":0.15,"towers":0.1,"obsolete":9}}',
    );

    const protectedBefore = protectedSnapshot(db);
    applyMigration(db, upgradeSql);

    expect(tableColumns(db, "member_profiles")).not.toEqual(
      expect.arrayContaining(["classes", "images", "vacation_start", "vacation_end"]),
    );
    expect(tableColumns(db, "events")).not.toContain("attachments");
    expect(tableColumns(db, "recurring_templates")).not.toEqual(
      expect.arrayContaining(["attachments", "timezone_offset_minutes"]),
    );

    expect(rows(
      db,
      `SELECT class_id, sort_order
       FROM member_profile_classes
       WHERE user_id = 'user-1'
       ORDER BY sort_order`,
    )).toEqual([
      { class_id: "鸣金虹", sort_order: 0 },
      { class_id: "牵丝霖", sort_order: 1 },
    ]);
    expect(rows(
      db,
      `SELECT class_id, sort_order
       FROM member_profile_classes
       WHERE user_id = 'user-2'
       ORDER BY sort_order`,
    )).toEqual([
      { class_id: "裂石威", sort_order: 0 },
      { class_id: "鸣金虹", sort_order: 1 },
    ]);
    expect(rows(
      db,
      `SELECT media_key, sort_order
       FROM member_profile_images
       WHERE user_id = 'user-1'
       ORDER BY sort_order`,
    )).toEqual([
      { media_key: "members/user-1/images/a.webp", sort_order: 0 },
      { media_key: "members/user-1/images/b.webp", sort_order: 1 },
    ]);
    expect(rows(
      db,
      `SELECT user_id, start_date, end_date
       FROM member_absences WHERE user_id = 'user-1'`,
    )).toEqual([{
      user_id: "user-1",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
    }]);
    expect(rows(db, "SELECT event_id, media_key, sort_order FROM event_attachments"))
      .toEqual([{
        event_id: "event-poll",
        media_key: "events/event-poll/images/a.webp",
        sort_order: 0,
      }]);
    expect(rows(
      db,
      "SELECT template_id, media_key, sort_order FROM recurring_template_attachments",
    )).toEqual([{
      template_id: "template-1",
      media_key: "events/template-1/images/a.webp",
      sort_order: 0,
    }]);

    for (const table of [
      "events",
      "event_participants",
      "event_polls",
      "event_poll_options",
      "event_poll_votes",
      "event_raffle_winners",
      "war_history",
      "war_teams",
      "war_team_members",
      "war_pool_members",
      "wiki_categories",
      "wiki_articles",
      "wiki_revisions",
      "storage_items",
      "storage_item_images",
      "storage_transactions",
    ]) {
      expect(rows(db, `SELECT count(*) AS count FROM ${table}`)[0]?.count, table)
        .toBeGreaterThan(0);
    }

    const analytics = JSON.parse(String(
      rows(
        db,
        "SELECT analytics_settings_json AS value FROM site_config WHERE id = 'default'",
      )[0]?.value,
    )) as { modifier_weights: Record<string, number> };
    expect(analytics.modifier_weights).toEqual({
      kills: 0.45,
      towers: 0.1,
      base_hp: 0.15,
      credits: 0.3,
      distance: 0.15,
    });

    expect(rows(
      db,
      "SELECT name, level FROM roles WHERE id = 'raider'",
    )).toEqual([{ name: "Raider", level: 200 }]);
    expect(rows(
      db,
      `SELECT permission, granted FROM role_permissions
       WHERE role_id = 'raider'`,
    )).toEqual([{ permission: "events.create", granted: 1 }]);
    expect(schemaObjectSql(db, "table", "roles"))
      .toContain("CONSTRAINT roles_level_positive CHECK");
    expect(schemaObjectSql(db, "index", "ux_users_username_nocase"))
      .toContain("username COLLATE NOCASE");
    expect(() => insertUser(db!, "user-case", "legacy-one"))
      .toThrow(/UNIQUE constraint failed/i);

    expect(protectedSnapshot(db)).toEqual(protectedBefore);
    expect(tableNames(db).has("legacy_onboarding_config")).toBe(false);
    expect(tableNames(db).has("legacy_member_onboarding_state")).toBe(false);

    const exactMediaRows = rows(
      db,
      `SELECT media_key, entity_type, entity_id
       FROM media_references
       WHERE media_key IN (
         'existing/key.webp',
         'members/user-1/avatar.webp',
         'members/user-1/images/a.webp',
         'events/event-poll/images/a.webp',
         'events/template-1/images/a.webp',
         'storage/items/item-1/images/a.webp',
         'announcement/announcement-1/images/a.webp',
         'wiki/article-1/images/a.webp'
       )
       ORDER BY media_key`,
    );
    expect(exactMediaRows).toHaveLength(8);
    expect(rows(db, "SELECT count(*) AS count FROM media_reference_backfills"))
      .toEqual([{ count: 0 }]);

    expect(() => db!.prepare(
      "INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)",
    ).run("orphan", "missing", "user-1")).toThrow(/FOREIGN KEY constraint failed/i);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(db, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("keeps the production-only tables untouched in migration SQL", () => {
    expect(upgradeSql).not.toMatch(
      /\b(?:ALTER\s+TABLE|DROP\s+TABLE|UPDATE|DELETE\s+FROM)\s+["']?(?:game_data|onboarding_config|member_onboarding_state)\b/i,
    );
    expect(upgradeSql).not.toMatch(/legacy_(?:onboarding_config|member_onboarding_state)/i);
    expect(upgradeSql).not.toMatch(
      /site_event_types|site_guild_war_|game_rules|AdminGameRulesEditor/i,
    );
  });

  it("fails preflight for malformed, conflicting, invalid, and orphaned legacy rows", () => {
    const corruptions: Array<readonly [
      string,
      (sqlite: DatabaseSync) => void,
    ]> = [
      ["bad JSON", (sqlite) => {
        insertUser(sqlite, "user-1", "json-user");
        sqlite.prepare(
          `INSERT INTO member_profiles
            (id, user_id, classes, images, video_urls)
           VALUES (?, ?, ?, ?, ?)`,
        ).run("profile-1", "user-1", "not-json", "[]", "[]");
      }],
      ["unknown profession", (sqlite) => {
        insertUser(sqlite, "user-1", "class-user");
        sqlite.prepare(
          `INSERT INTO member_profiles
            (id, user_id, classes, images, video_urls)
           VALUES (?, ?, ?, ?, ?)`,
        ).run("profile-1", "user-1", '["missing-class"]', "[]", "[]");
      }],
      ["case-insensitive username conflict", (sqlite) => {
        insertUser(sqlite, "user-1", "CaseName");
        insertUser(sqlite, "user-2", "casename");
      }],
      ["negative member power", (sqlite) => {
        insertUser(sqlite, "user-1", "power-user");
        sqlite.exec("PRAGMA ignore_check_constraints = ON;");
        sqlite.prepare(
          `INSERT INTO member_profiles (id, user_id, power)
           VALUES (?, ?, ?)`,
        ).run("profile-1", "user-1", -1);
        sqlite.exec("PRAGMA ignore_check_constraints = OFF;");
      }],
      ["nonpositive event capacity", (sqlite) => {
        insertUser(sqlite, "user-1", "event-capacity-user");
        sqlite.exec("PRAGMA ignore_check_constraints = ON;");
        sqlite.prepare(
          `INSERT INTO events
            (id, type, title, start_at, capacity, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          "event-1",
          "social",
          "Invalid capacity",
          "2026-08-10T00:00:00.000Z",
          0,
          "user-1",
        );
        sqlite.exec("PRAGMA ignore_check_constraints = OFF;");
      }],
      ["nonpositive event winner count", (sqlite) => {
        insertUser(sqlite, "user-1", "event-winner-user");
        sqlite.exec("PRAGMA ignore_check_constraints = ON;");
        sqlite.prepare(
          `INSERT INTO events
            (id, type, title, start_at, winner_count, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          "event-1",
          "raffle",
          "Invalid winner count",
          "2026-08-10T00:00:00.000Z",
          0,
          "user-1",
        );
        sqlite.exec("PRAGMA ignore_check_constraints = OFF;");
      }],
      ["nonpositive recurring template capacity", (sqlite) => {
        insertUser(sqlite, "user-1", "template-capacity-user");
        sqlite.exec("PRAGMA ignore_check_constraints = ON;");
        sqlite.prepare(
          `INSERT INTO recurring_templates
            (id, type, title, start_time, capacity, recurrence_rule, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          "template-1",
          "social",
          "Invalid capacity",
          "20:00",
          0,
          '{"frequency":"weekly"}',
          "user-1",
        );
        sqlite.exec("PRAGMA ignore_check_constraints = OFF;");
      }],
      ["nonpositive war duration", (sqlite) => {
        insertUser(sqlite, "user-1", "war-duration-user");
        sqlite.exec("PRAGMA ignore_check_constraints = ON;");
        sqlite.prepare(
          `INSERT INTO war_history
            (id, war_name, duration_minutes, created_by)
           VALUES (?, ?, ?, ?)`,
        ).run("war-1", "Invalid duration", 0, "user-1");
        sqlite.exec("PRAGMA ignore_check_constraints = OFF;");
      }],
      ["invalid event enum", (sqlite) => {
        insertUser(sqlite, "user-1", "enum-user");
        sqlite.prepare(
          `INSERT INTO recurring_templates
            (id, type, title, start_time, recurrence_rule, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          "template-1",
          "dynamic-event",
          "Invalid",
          "20:00",
          '{"frequency":"weekly"}',
          "user-1",
        );
      }],
      ["orphan relationship", (sqlite) => {
        sqlite.prepare(
          `INSERT INTO event_participants
            (id, event_id, user_id) VALUES (?, ?, ?)`,
        ).run("participant-1", "missing-event", "missing-user");
      }],
    ];

    for (const [label, corrupt] of corruptions) {
      const sqlite = createBaselineDatabase();
      try {
        corrupt(sqlite);
        expect(() => applyMigration(sqlite, upgradeSql), label)
          .toThrow(/release_upgrade_guard_valid/i);
        expect(tableColumns(sqlite, "member_profiles"), label).toContain("classes");
        expect(tableNames(sqlite).has("onboarding_config"), label).toBe(true);
        expect(tableNames(sqlite).has("member_onboarding_state"), label).toBe(true);
      } finally {
        sqlite.close();
      }
    }
  });

  it("builds fresh through 0000 then 0001 and adds exactly the required tables", () => {
    const baseline = createBaselineDatabase();
    try {
      const baselineTables = tableNames(baseline);
      expect(baselineTables.has("d1_migrations")).toBe(false);
      for (const table of newTables) {
        expect(baselineTables.has(table), `0000 unexpectedly contains ${table}`)
          .toBe(false);
      }
      for (const table of protectedTables) expect(baselineTables.has(table)).toBe(true);
    } finally {
      baseline.close();
    }

    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);

    const finalTables = tableNames(db);
    for (const table of newTables) expect(finalTables.has(table), table).toBe(true);
    for (const table of protectedTables) expect(finalTables.has(table), table).toBe(true);
    expect(rows(db, "SELECT count(*) AS count FROM roles")).toEqual([{ count: 3 }]);
    expect(rows(db, "SELECT count(*) AS count FROM class_catalog"))
      .toEqual([{ count: 10 }]);
    expect(rows(db, "SELECT count(*) AS count FROM site_config"))
      .toEqual([{ count: 1 }]);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(db, "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("retains the three required named static CHECK constraints", () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
    insertUser(db, "user-1", "constraint-user");

    expect(schemaObjectSql(db, "table", "events"))
      .toContain("CONSTRAINT events_type_valid CHECK");
    expect(schemaObjectSql(db, "table", "recurring_templates"))
      .toContain("CONSTRAINT recurring_templates_type_valid CHECK");
    expect(schemaObjectSql(db, "table", "war_history"))
      .toContain("CONSTRAINT war_history_result_valid CHECK");

    expect(() => db!.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "bad-event",
      "dynamic-event",
      "Bad",
      "2026-08-10T00:00:00.000Z",
      "user-1",
    )).toThrow(/events_type_valid/i);
    expect(() => db!.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_rule, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "bad-template",
      "dynamic-event",
      "Bad",
      "20:00",
      '{"frequency":"weekly"}',
      "user-1",
    )).toThrow(/recurring_templates_type_valid/i);
    expect(() => db!.prepare(
      `INSERT INTO war_history
        (id, war_name, result, created_by) VALUES (?, ?, ?, ?)`,
    ).run("bad-war", "Bad", "victory", "user-1"))
      .toThrow(/war_history_result_valid/i);
  });

  it("enforces composite poll foreign keys and storage ledger RESTRICT", () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);
    insertUser(db, "user-1", "fk-user-one");
    insertUser(db, "user-2", "fk-user-two");

    const insertEvent = db.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by)
       VALUES (?, 'poll', ?, ?, ?)`,
    );
    insertEvent.run(
      "event-1",
      "One",
      "2026-08-10T00:00:00.000Z",
      "user-1",
    );
    insertEvent.run(
      "event-2",
      "Two",
      "2026-08-11T00:00:00.000Z",
      "user-1",
    );
    db.prepare(
      "INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, ?)",
    ).run("option-1", "event-1", "A");

    expect(() => db!.prepare(
      `INSERT INTO event_poll_votes
        (id, event_id, option_id, user_id) VALUES (?, ?, ?, ?)`,
    ).run("vote-1", "event-2", "option-1", "user-2"))
      .toThrow(/FOREIGN KEY constraint failed/i);

    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?)")
      .run("storage-1", "Main");
    db.prepare(
      "INSERT INTO storage_items (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)",
    ).run("item-1", "storage-1", "Potion", 1);
    db.prepare(
      `INSERT INTO storage_transactions
        (id, item_id, type, quantity_delta, actor_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("tx-1", "item-1", "intake", 1, "user-1");

    expect(() => db!.prepare("DELETE FROM storage_items WHERE id = ?")
      .run("item-1")).toThrow(/FOREIGN KEY constraint failed/i);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
