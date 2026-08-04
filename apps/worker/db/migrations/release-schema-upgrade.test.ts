import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, migrationDirectory, migrationFiles } from "./migration-test-utils";

type Row = Record<string, string | number | null>;

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function rows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

describe("release schema upgrade", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("upgrades the applied v1 baseline without losing legacy data", () => {
    expect(migrationFiles).toEqual([
      "0000_core_schema.sql",
      "0001_release_schema_upgrade.sql",
    ]);

    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(readFileSync(`${migrationDirectory}/0000_core_schema.sql`, "utf8"));

    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run("user-1", "legacy-one", "member");
    db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run("user-2", "legacy-two", "member");
    db.prepare(
      `INSERT INTO member_profiles
        (id, user_id, power, classes, avatar_key, images, audio_key, video_urls, availability, vacation_start, vacation_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "profile-1",
      "user-1",
      123.5,
      '["鸣金虹","牵丝霖"]',
      "members/user-1/avatar.webp",
      '["members/user-1/images/a.webp","members/user-1/images/b.webp"]',
      "members/user-1/audio.opus",
      "[]",
      '{"monday":true}',
      "2026-08-10",
      "2026-08-12",
    );
    db.prepare("INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)").run("user-1", "裂石威");
    db.prepare(
      `INSERT INTO member_profiles
        (id, user_id, classes, images, video_urls, availability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("profile-2", "user-2", "[]", "[]", "[]", "{}");
    db.prepare("INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)").run("user-2", "鸣金虹");
    db.prepare("INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)").run("user-2", "裂石威");

    db.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("event-poll", "poll", "Legacy poll", "2026-08-10T00:00:00.000Z", "user-1", '["events/event-poll/images/a.webp"]');
    db.prepare(
      `INSERT INTO events
        (id, type, title, start_at, created_by, attachments)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("event-war", "guild_war", "Legacy war", "2026-08-11T00:00:00.000Z", "user-1", "[]");
    db.prepare(
      `INSERT INTO recurring_templates
        (id, type, title, start_time, recurrence_rule, attachments, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("template-1", "social", "Legacy recurring", "20:00", '{"frequency":"weekly"}', '["events/template-1/images/a.webp"]', "user-1");
    db.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES (?, ?, ?)").run("participant-1", "event-poll", "user-2");
    db.prepare("INSERT INTO event_polls (event_id) VALUES (?)").run("event-poll");
    db.prepare("INSERT INTO event_poll_options (id, event_id, label) VALUES (?, ?, ?)").run("option-1", "event-poll", "A");
    db.prepare("INSERT INTO event_poll_votes (id, event_id, option_id, user_id) VALUES (?, ?, ?, ?)").run("vote-1", "event-poll", "option-1", "user-2");
    db.prepare("INSERT INTO event_raffle_winners (id, event_id, user_id) VALUES (?, ?, ?)").run("winner-1", "event-poll", "user-2");
    db.prepare("INSERT INTO war_history (id, event_id, war_name, own_stats, enemy_stats, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run("history-1", "event-war", "Legacy history", '{"kills":5}', '{"kills":4}', "user-1");
    db.prepare("INSERT INTO war_teams (id, war_history_id, team_name) VALUES (?, ?, ?)").run("team-1", "history-1", "Alpha");
    db.prepare("INSERT INTO war_team_members (id, war_team_id, user_id, stats) VALUES (?, ?, ?, ?)")
      .run("team-member-1", "team-1", "user-1", '{"kills":5}');
    db.prepare("INSERT INTO war_pool_members (id, event_id, user_id) VALUES (?, ?, ?)").run("pool-1", "event-war", "user-2");

    db.prepare("INSERT INTO announcements (id, title, body_json, created_by) VALUES (?, ?, ?, ?)")
      .run("announcement-1", "Legacy", '{"type":"doc","content":[]}', "user-1");
    db.prepare("INSERT INTO wiki_categories (id, name, slug) VALUES (?, ?, ?)").run("category-1", "Root", "root");
    db.prepare("INSERT INTO wiki_categories (id, name, slug, parent_id) VALUES (?, ?, ?, ?)").run("category-2", "Child", "child", "category-1");
    db.prepare("INSERT INTO wiki_articles (id, title, slug, category_id, body_json, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run("article-1", "Legacy", "legacy", "category-2", '{"type":"doc","content":[]}', "user-1");
    db.prepare("INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run("revision-1", "article-1", 1, "Legacy", '{"type":"doc","content":[]}', "user-1");

    db.prepare("INSERT INTO storages (id, name) VALUES (?, ?)").run("storage-1", "Legacy storage");
    db.prepare("INSERT INTO storage_items (id, storage_id, name, quantity) VALUES (?, ?, ?, ?)").run("item-1", "storage-1", "Potion", 4);
    db.prepare("INSERT INTO storage_item_images (id, item_id, r2_key) VALUES (?, ?, ?)")
      .run("storage-image-1", "item-1", "storage/items/item-1/images/a.webp");
    db.prepare("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, actor_id) VALUES (?, ?, ?, ?, ?)")
      .run("transaction-1", "item-1", "intake", 4, "user-1");
    db.prepare("INSERT INTO gallery_items (id, type, url, uploaded_by) VALUES (?, ?, ?, ?)")
      .run("gallery-1", "image", "gallery/gallery-1/image.webp", "user-1");
    db.prepare("INSERT INTO media_references (media_key, entity_type, entity_id) VALUES (?, ?, ?)")
      .run("existing/key.webp", "gallery_item", "existing");
    db.prepare("INSERT INTO member_onboarding_state (user_id, completed_item_ids_json) VALUES (?, ?)")
      .run("user-1", '["read-rules"]');
    db.prepare(
      "UPDATE site_config SET analytics_settings_json = ? WHERE id = 'default'",
    ).run('{"reference_duration_minutes":30,"modifier_weights":{"credits":0.3,"kills":0.9,"kda":0.3,"basehp":0.15,"towers":0.1,"obsolete":9}}');

    db.exec(readFileSync(`${migrationDirectory}/0001_release_schema_upgrade.sql`, "utf8"));

    expect(tableColumns(db, "member_profiles")).not.toEqual(expect.arrayContaining(["classes", "images", "vacation_start", "vacation_end"]));
    expect(tableColumns(db, "events")).not.toContain("attachments");
    expect(tableColumns(db, "recurring_templates")).not.toEqual(expect.arrayContaining(["attachments", "timezone_offset_minutes"]));
    expect(rows(db, "SELECT class_id, sort_order FROM member_profile_classes WHERE user_id = 'user-1' ORDER BY sort_order"))
      .toEqual([{ class_id: "鸣金虹", sort_order: 0 }, { class_id: "牵丝霖", sort_order: 1 }]);
    expect(rows(db, "SELECT class_id, sort_order FROM member_profile_classes WHERE user_id = 'user-2' ORDER BY sort_order"))
      .toEqual([{ class_id: "裂石威", sort_order: 0 }, { class_id: "鸣金虹", sort_order: 1 }]);
    expect(rows(db, "SELECT media_key, sort_order FROM member_profile_images WHERE user_id = 'user-1' ORDER BY sort_order"))
      .toEqual([
        { media_key: "members/user-1/images/a.webp", sort_order: 0 },
        { media_key: "members/user-1/images/b.webp", sort_order: 1 },
      ]);
    expect(rows(db, "SELECT user_id, start_date, end_date FROM member_absences WHERE user_id = 'user-1'"))
      .toEqual([{ user_id: "user-1", start_date: "2026-08-10", end_date: "2026-08-12" }]);
    expect(rows(db, "SELECT event_id, media_key, sort_order FROM event_attachments"))
      .toEqual([{ event_id: "event-poll", media_key: "events/event-poll/images/a.webp", sort_order: 0 }]);
    expect(rows(db, "SELECT template_id, media_key, sort_order FROM recurring_template_attachments"))
      .toEqual([{ template_id: "template-1", media_key: "events/template-1/images/a.webp", sort_order: 0 }]);

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
      "storage_transactions",
    ]) {
      expect(rows(db, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.count, table).toBeGreaterThan(0);
    }

    const analytics = JSON.parse(String(rows(db, "SELECT analytics_settings_json AS value FROM site_config WHERE id = 'default'")[0]?.value)) as {
      modifier_weights: Record<string, number>;
    };
    expect(analytics.modifier_weights).toMatchObject({ kills: 0.9, base_hp: 0.15 });
    expect(Object.keys(analytics.modifier_weights).sort()).toEqual([
      "base_hp",
      "credits",
      "distance",
      "kills",
      "towers",
    ]);
    expect(analytics.modifier_weights).not.toHaveProperty("kda");
    expect(analytics.modifier_weights).not.toHaveProperty("basehp");

    expect(rows(db, "SELECT title FROM legacy_onboarding_config WHERE id = 'default'")).toHaveLength(1);
    expect(rows(db, "SELECT completed_item_ids_json FROM legacy_member_onboarding_state WHERE user_id = 'user-1'"))
      .toEqual([{ completed_item_ids_json: '["read-rules"]' }]);
    expect(rows(db, "SELECT COUNT(*) AS count FROM media_reference_backfills")[0]?.count).toBe(0);
    expect(rows(db, "SELECT media_key, entity_type, entity_id FROM media_references WHERE media_key IN ('existing/key.webp', 'members/user-1/avatar.webp', 'members/user-1/images/a.webp', 'events/event-poll/images/a.webp', 'events/template-1/images/a.webp', 'storage/items/item-1/images/a.webp') ORDER BY media_key"))
      .toEqual([
        { media_key: "events/event-poll/images/a.webp", entity_type: "event", entity_id: "event-poll" },
        { media_key: "events/template-1/images/a.webp", entity_type: "recurring_template", entity_id: "template-1" },
        { media_key: "existing/key.webp", entity_type: "gallery_item", entity_id: "existing" },
        { media_key: "members/user-1/avatar.webp", entity_type: "member_profile", entity_id: "user-1" },
        { media_key: "members/user-1/images/a.webp", entity_type: "member_profile", entity_id: "user-1" },
        { media_key: "storage/items/item-1/images/a.webp", entity_type: "storage_item", entity_id: "item-1" },
      ]);

    expect(() => db!.prepare("INSERT INTO event_participants (id, event_id, user_id) VALUES ('bad', 'missing', 'user-1')").run())
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db!.prepare("INSERT INTO member_absences (id, user_id, start_date, end_date) VALUES ('bad', 'user-1', '2026-08-12', '2026-08-10')").run())
      .toThrow(/member_absences_date_range_valid/i);
    expect(() => db!.prepare("DELETE FROM storage_items WHERE id = 'item-1'").run())
      .toThrow(/FOREIGN KEY constraint failed/i);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("fails instead of silently coercing malformed or incomplete legacy profile data", () => {
    const baselineSql = readFileSync(`${migrationDirectory}/0000_core_schema.sql`, "utf8");
    const upgradeSql = readFileSync(`${migrationDirectory}/0001_release_schema_upgrade.sql`, "utf8");
    const corruptions: Array<readonly [string, (sqlite: DatabaseSync) => void]> = [
      ["invalid classes JSON", (sqlite) => sqlite.prepare("UPDATE member_profiles SET classes = ? WHERE user_id = 'user-1'").run("not-json")],
      ["unknown class id", (sqlite) => sqlite.prepare("UPDATE member_profiles SET classes = ? WHERE user_id = 'user-1'").run('["missing-class"]')],
      ["invalid images JSON", (sqlite) => sqlite.prepare("UPDATE member_profiles SET images = ? WHERE user_id = 'user-1'").run("not-json")],
      ["invalid video URL JSON", (sqlite) => sqlite.prepare("UPDATE member_profiles SET video_urls = ? WHERE user_id = 'user-1'").run("not-json")],
      ["invalid availability JSON", (sqlite) => sqlite.prepare("UPDATE member_profiles SET availability = ? WHERE user_id = 'user-1'").run("[]")],
      ["one-sided vacation", (sqlite) => sqlite.prepare("UPDATE member_profiles SET vacation_start = ?, vacation_end = NULL WHERE user_id = 'user-1'").run("2026-08-10")],
      ["unknown fallback relation", (sqlite) => sqlite.prepare("INSERT INTO member_profile_classes (user_id, class) VALUES (?, ?)").run("user-1", "missing-class")],
      ["invalid analytics duration", (sqlite) => sqlite.prepare("UPDATE site_config SET analytics_settings_json = ? WHERE id = 'default'").run('{"reference_duration_minutes":"thirty","modifier_weights":{}}')],
      ["invalid analytics weight", (sqlite) => sqlite.prepare("UPDATE site_config SET analytics_settings_json = ? WHERE id = 'default'").run('{"reference_duration_minutes":30,"modifier_weights":{"kills":"high"}}')],
    ];

    for (const [label, corrupt] of corruptions) {
      const sqlite = new DatabaseSync(":memory:");
      try {
        sqlite.exec("PRAGMA foreign_keys = ON;");
        sqlite.exec(baselineSql);
        sqlite.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run("user-1", `legacy-${label}`, "member");
        sqlite.prepare(
          `INSERT INTO member_profiles
            (id, user_id, classes, images, video_urls, availability)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run("profile-1", "user-1", '["鸣金虹"]', "[]", "[]", "{}");
        corrupt(sqlite);

        expect(() => sqlite.exec(upgradeSql), label).toThrow();
      } finally {
        sqlite.close();
      }
    }
  });

  it("builds the final runtime schema from every migration on an empty database", () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    applyMigrations(db);

    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
    for (const table of [
      "member_profile_images",
      "class_tags",
      "event_attachments",
      "event_class_quotas",
      "media_reference_backfills",
      "media_upload_leases",
      "legacy_onboarding_config",
      "legacy_member_onboarding_state",
    ]) expect(tables.has(table), table).toBe(true);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });
});
