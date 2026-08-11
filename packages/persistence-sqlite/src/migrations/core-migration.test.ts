import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@guild/shared/constants/roles";
import { LIMITS } from "@guild/shared/config/limits";
import {
  DEFAULT_SITE_ABSENCE_POLICY,
  DEFAULT_SITE_ANALYTICS_SETTINGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_STORAGE_POLICY,
} from "@guild/shared/schemas/site-config";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlStatement } from "@guild/kernel";
import { SqliteGalleryStore } from "../stores/gallery-store.js";
import { SqliteSiteConfigStore } from "../stores/site-config-store.js";
import { SqliteWikiStore } from "../stores/wiki-store.js";

const migration = readFileSync(fileURLToPath(new URL("./generated/0000_core.sql", import.meta.url)), "utf8")
  .replaceAll("--> statement-breakpoint", "");
const [coreManifestEntry] = JSON.parse(readFileSync(
  fileURLToPath(new URL("./generated/manifest.json", import.meta.url)),
  "utf8",
)) as Array<{ id: string; ordinal: number; file: string; checksum: string }>;
const coreManifest = {
  id: coreManifestEntry!.id,
  ordinal: coreManifestEntry!.ordinal,
  checksum: coreManifestEntry!.checksum,
};
const invariantNames = [
  "app-migrations.invariants.sql",
  "audit-invariants.sql",
  "auth-triggers.sql",
  "events.invariants.sql",
  "guild-war.invariants.sql",
  "media-triggers.sql",
  "media-target-invariants.sql",
  "storage-invariants.sql",
  "system-test.invariants.sql",
  "wiki-triggers.sql",
] as const;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("core modular backend migration", () => {
  it("applies once with every domain table, invariant trigger, and no foreign-key violations", () => {
    const database = migratedDatabase();
    const tables = values(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    expect(tables).toHaveLength(58);
    expect(tables).toEqual(expect.arrayContaining([
      "roles", "users", "events", "guild_wars", "storage_ledger_entries", "announcements",
      "wiki_articles", "gallery_items", "media_assets", "site_config", "audit_archives",
      "scheduled_job_leases", "app_migrations", "error_log", "system_test_runs",
      "system_test_requests", "system_test_artifacts", "system_test_before_images",
      "wiki_revision_media",
    ]));
    expect(tables).not.toEqual(expect.arrayContaining(["game_definitions", "media_references", "media_leases"]));

    const expectedTriggers = invariantNames.flatMap((name) => {
      const source = readFileSync(fileURLToPath(new URL(`../schema/${name}`, import.meta.url)), "utf8");
      return [...source.matchAll(/CREATE TRIGGER\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    }).sort();
    expect(values(database, "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"))
      .toEqual(expectedTriggers);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("seeds the append-only application migration ledger", () => {
    const database = migratedDatabase();
    expect(database.prepare(
      "SELECT id, ordinal, checksum FROM app_migrations",
    ).all()).toEqual([coreManifest]);
    expect(() => database.prepare(
      "INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0001_duplicate', 0, ?)",
    ).run("0".repeat(64))).toThrow(/constraint/i);
    expect(() => database.prepare(
      "INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0001_invalid', 1, 'not-a-checksum')",
    ).run()).toThrow(/constraint/i);
    database.prepare(
      "INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('0001_fixture', 1, ?)",
    ).run("0".repeat(64));
    expect(database.prepare("SELECT id FROM app_migrations ORDER BY ordinal").all())
      .toEqual([{ id: "0000_core" }, { id: "0001_fixture" }]);
    expect(() => database.prepare("UPDATE app_migrations SET checksum = ? WHERE ordinal = 1")
      .run("1".repeat(64))).toThrow(/append-only/i);
    expect(() => database.prepare("DELETE FROM app_migrations WHERE ordinal = 1").run())
      .toThrow(/append-only/i);
  });

  it("installs scheduled job leases as the constrained WITHOUT ROWID table", () => {
    const database = migratedDatabase();
    const tableSql = scalarText(
      database,
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_job_leases'",
    );
    expect(tableSql).toMatch(/WITHOUT ROWID$/i);
    database.prepare(`INSERT INTO scheduled_job_leases (job_name, lease_token, acquired_at, expires_at)
      VALUES ('media-gc', 'lease-token-0001', '2026-08-09T12:00:00.000Z', '2026-08-09T12:10:00.000Z')`).run();
    database.prepare(`INSERT INTO scheduled_job_leases (job_name, lease_token, acquired_at, expires_at)
      VALUES ('announcement-publish', 'lease-token-0002', '2026-08-09T12:00:00.000Z', '2026-08-09T12:10:00.000Z'),
        ('raffle-auto-draw', 'lease-token-0003', '2026-08-09T12:00:00.000Z', '2026-08-09T12:10:00.000Z')`).run();
    expect(() => database.prepare(`INSERT INTO scheduled_job_leases (job_name, lease_token, acquired_at, expires_at)
      VALUES ('unknown', 'lease-token-0002', '2026-08-09T12:00:00.000Z', '2026-08-09T12:10:00.000Z')`).run())
      .toThrow(/constraint/i);
    expect(() => database.prepare(`INSERT INTO scheduled_job_leases (job_name, lease_token, acquired_at, expires_at)
      VALUES ('session-cleanup', 'short', '2026-08-09T12:10:00.000Z', '2026-08-09T12:00:00.000Z')`).run())
      .toThrow(/constraint/i);
  });

  it("enforces the recurring template catalog limit in the real schema", () => {
    const database = migratedDatabase();
    database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)")
      .run("template-creator", "Template Creator", "template-creator-revision-0001");
    const insertTemplate = database.prepare(`INSERT INTO recurring_templates (
      id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by
    ) VALUES (?, 'other', ?, '12:00', 'daily', 1, 'template-creator')`);
    for (let index = 0; index < LIMITS.content.recurringTemplateCatalog.max; index += 1) {
      insertTemplate.run(`template-${index}`, `Template ${index}`);
    }

    expect(() => insertTemplate.run("template-overflow", "Overflow"))
      .toThrow(/recurring template catalog limit reached/i);
    expect(values(database, "SELECT id FROM recurring_templates")).toHaveLength(LIMITS.content.recurringTemplateCatalog.max);
  });

  it("seeds roles and permissions from the shared canonical constants", () => {
    const database = migratedDatabase();
    const roles = database.prepare("SELECT id, name, level, color FROM roles ORDER BY level DESC").all();
    expect(roles).toEqual(BUILT_IN_ROLES.map(({ id, name, level, color }) => ({ id, name, level, color })));
    for (const role of BUILT_IN_ROLES) {
      expect(values(database, "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission", role.id))
        .toEqual([...role.permissions].sort());
    }
  });

  it("seeds the scalar Site Config contract and enforces its shared hard bounds", async () => {
    const database = migratedDatabase();
    const site = await new SqliteSiteConfigStore(new SqliteTestExecutor(database)).get();
    expect(site).toMatchObject({
      site_name: "Infini Guild",
      default_site_logo_url: "/guild-logo.svg",
      media_policy: DEFAULT_SITE_MEDIA_POLICY,
      storage_policy: DEFAULT_SITE_STORAGE_POLICY,
      absence_policy: DEFAULT_SITE_ABSENCE_POLICY,
      analytics_settings: DEFAULT_SITE_ANALYTICS_SETTINGS,
    });
    expect(() => database.prepare("UPDATE site_config SET quota_gallery = 101 WHERE singleton = 1").run())
      .toThrow(/constraint/i);
    expect(() => database.prepare("UPDATE site_config SET analytics_weight_kills = 1000001 WHERE singleton = 1").run())
      .toThrow(/constraint/i);
  });

  it("keeps the real Gallery and Wiki list queries on stable sort indexes", async () => {
    const database = migratedDatabase();
    const captured = new CapturingExecutor(new SqliteTestExecutor(database));
    const gallery = new SqliteGalleryStore(captured);
    const wiki = new SqliteWikiStore(captured);

    await gallery.list({ cursor: null, limit: 24, order: "desc" });
    expectPlan(database, captured.executed.at(-1), "idx_gallery_items_created");

    await gallery.list({ cursor: null, limit: 24, order: "desc", type: "image" });
    expectPlan(database, captured.executed.at(-1), "idx_gallery_items_type_created");

    await wiki.listArticles({
      page: 1,
      limit: 50,
      categoryIds: [],
      sort: "curated",
      canReadArchived: false,
    });
    expectPlan(database, captured.batches.at(-1)?.[1], "idx_wiki_articles_public_curated");
  });

  it("uses covering unique indexes after removing redundant ordered-read indexes", () => {
    const database = migratedDatabase();
    expect(values(database, `SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN (
        'idx_event_poll_options_event',
        'idx_media_links_target',
        'idx_wiki_revisions_article_latest'
      ) ORDER BY name`)).toEqual([]);

    database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)")
      .run("index-user", "IndexUser", "index-user-revision-0001");
    database.prepare(`INSERT INTO events (id, type, title, start_at, end_at, created_by)
      VALUES ('event-index', 'poll', 'Index Poll', '2026-08-10T12:00:00.000Z',
        '2026-08-10T13:00:00.000Z', 'index-user')`).run();
    database.prepare("INSERT INTO event_polls (event_id) VALUES ('event-index')").run();
    database.prepare(`INSERT INTO event_poll_options (id, event_id, label, sort_order) VALUES
      ('option-b', 'event-index', 'B', 1), ('option-a', 'event-index', 'A', 0)`).run();

    database.prepare("INSERT INTO member_profiles (user_id, revision_token) VALUES (?, ?)")
      .run("index-user", "index-profile-revision-0001");
    database.prepare(`INSERT INTO media_assets (id, owner_user_id, purpose, media_type, state, expires_at) VALUES
      ('media-index-000000001', 'index-user', 'member_image', 'image', 'staged', '2026-08-10T12:00:00.000Z'),
      ('media-index-000000002', 'index-user', 'member_image', 'image', 'staged', '2026-08-10T12:00:00.000Z')`).run();
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order) VALUES
      ('media-index-000000001', 'member_profile', 'index-user', 'image', 'authenticated', 1),
      ('media-index-000000002', 'member_profile', 'index-user', 'image', 'authenticated', 0)`).run();

    database.prepare(`INSERT INTO wiki_categories (id, name, slug, revision_token)
      VALUES ('category-index', 'Index', 'index', 'index-category-revision-0001')`).run();
    database.prepare(`INSERT INTO wiki_articles
      (id, title, slug, category_id, body_json, created_by, current_revision, revision_token)
      VALUES ('article-index', 'One', 'article-index', 'category-index', '{}', 'index-user', 1,
        'index-article-revision-0001')`).run();
    database.prepare(`INSERT INTO wiki_revisions
      (id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned, edited_by) VALUES
      ('revision-index-1', 'article-index', 1, 'One', 'article-index', 'category-index', '{}', 0, 0, 'index-user')`).run();
    database.prepare(`UPDATE wiki_articles
      SET title = 'Two', current_revision = 2, revision_token = 'index-article-revision-0002'
      WHERE id = 'article-index'`).run();
    database.prepare(`INSERT INTO wiki_revisions
      (id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned, edited_by) VALUES
      ('revision-index-2', 'article-index', 2, 'Two', 'article-index', 'category-index', '{}', 0, 0, 'index-user')`).run();

    const pollSql = "SELECT id FROM event_poll_options WHERE event_id = ? ORDER BY sort_order, id";
    const mediaSql = `SELECT media_id FROM media_links
      WHERE entity_type = ? AND entity_id = ? AND slot = ? ORDER BY sort_order, media_id`;
    const revisionSql = "SELECT id FROM wiki_revisions WHERE article_id = ? ORDER BY revision DESC";
    expect(values(database, pollSql, "event-index")).toEqual(["option-a", "option-b"]);
    expect(values(database, mediaSql, "member_profile", "index-user", "image"))
      .toEqual(["media-index-000000002", "media-index-000000001"]);
    expect(values(database, revisionSql, "article-index")).toEqual(["revision-index-2", "revision-index-1"]);
    expect(() => database.prepare("UPDATE event_poll_options SET sort_order = 0 WHERE id = 'option-b'").run())
      .toThrow(/constraint/i);
    expect(() => database.prepare(`UPDATE media_links SET sort_order = 0
      WHERE media_id = 'media-index-000000001'`).run()).toThrow(/constraint/i);
    expect(() => database.prepare(`INSERT INTO wiki_revisions
      (id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned, edited_by)
      VALUES ('revision-index-duplicate', 'article-index', 2, 'Two', 'article-index',
        'category-index', '{}', 0, 0, 'index-user')`).run()).toThrow(/constraint/i);

    expectPlan(database, { method: "all", sql: pollSql, params: ["event-index"] },
      "ux_event_poll_options_event_sort");
    expectPlan(database, {
      method: "all",
      sql: mediaSql,
      params: ["member_profile", "index-user", "image"],
    }, "ux_media_links_target_order");
    expectPlan(database, { method: "all", sql: revisionSql, params: ["article-index"] },
      "ux_wiki_revisions_article_revision");
  });

  it("installs revision and site-owner trust-root defenses in the real schema", () => {
    const database = migratedDatabase();
    expect(() => database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, ?, ?)")
      .run("bad-user", "Bad", "member", "short"))
      .toThrow(/constraint/i);

    database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, ?, ?)")
      .run("owner-1", "Owner", "site_owner", "owner-user-revision-0001");
    expect(() => database.prepare("UPDATE role_permissions SET role_id = 'member' WHERE role_id = ? AND permission = ?")
      .run("admin", "admin.roles.manage"))
      .toThrow(/role permission identity is immutable/i);
    expect(() => database.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)")
      .run("admin", "admin.owners.manage"))
      .toThrow(/reserved for site owner/i);
    expect(() => database.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission = ?")
      .run("site_owner", "admin.owners.manage"))
      .toThrow(/last site owner required/i);
    expect(() => database.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run("owner-1"))
      .toThrow(/last site owner required/i);
    expect(() => database.prepare("UPDATE roles SET level = 999 WHERE id = 'site_owner'").run())
      .toThrow(/constraint/i);
    expect(() => database.prepare(`INSERT INTO roles
      (id, name, level, revision_token) VALUES ('peer-root', 'Peer Root', 1000, 'peer-root-revision-0001')`).run())
      .toThrow(/constraint/i);

    database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, ?, ?)")
      .run("temporary-member", "TemporaryMember", "member", "temporary-user-revision-0001");
    database.prepare(`INSERT INTO login_failures (username, fail_count, locked_until)
      VALUES ('temporarymember', 4, '2099-01-01T00:00:00.000Z')`).run();
    database.prepare("DELETE FROM users WHERE id = 'temporary-member'").run();
    expect(database.prepare("SELECT 1 FROM login_failures WHERE username = 'temporarymember'").get())
      .toBeUndefined();
  });

  it("enforces NEW scope on event children and scoped class tags", () => {
    const database = migratedDatabase();
    database.prepare("INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)")
      .run("creator-1", "Creator", "creator-revision-0001");
    const insertEvent = database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, created_by
    ) VALUES (?, ?, ?, ?, ?, 'creator-1')`);
    insertEvent.run("event-a", "other", "Event A", "2026-08-10T12:00:00.000Z", null);
    insertEvent.run("event-b", "other", "Event B", "2026-08-11T12:00:00.000Z", null);
    insertEvent.run(
      "event-poll",
      "poll",
      "Poll",
      "2026-08-12T12:00:00.000Z",
      "2026-08-12T13:00:00.000Z",
    );
    database.prepare(`INSERT INTO class_tags (id, label, owner_kind, owner_id)
      VALUES ('tag-event-a', 'Event A tag', 'event', 'event-a')`).run();
    database.prepare("INSERT INTO event_class_quotas (event_id, tag_id, required) VALUES ('event-a', 'tag-event-a', 1)")
      .run();

    expect(() => database.prepare("UPDATE event_class_quotas SET event_id = 'event-b' WHERE event_id = 'event-a'").run())
      .toThrow(/outside event scope/i);
    expect(() => database.prepare("UPDATE class_tags SET owner_id = 'event-b' WHERE id = 'tag-event-a'").run())
      .toThrow(/class tag scope is immutable/i);

    const insertTemplate = database.prepare(`INSERT INTO recurring_templates (
      id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by
    ) VALUES (?, 'other', ?, '12:00', 'weekly', 1, 'creator-1')`);
    insertTemplate.run("template-a", "Template A");
    insertTemplate.run("template-b", "Template B");
    database.prepare(`INSERT INTO class_tags (id, label, owner_kind, owner_id)
      VALUES ('tag-template-a', 'Template A tag', 'recurring_template', 'template-a')`).run();
    database.prepare(`INSERT INTO recurring_template_class_quotas (template_id, tag_id, required)
      VALUES ('template-a', 'tag-template-a', 1)`).run();
    expect(() => database.prepare(`UPDATE recurring_template_class_quotas
      SET template_id = 'template-b' WHERE template_id = 'template-a'`).run())
      .toThrow(/outside template scope/i);

    database.prepare("INSERT INTO event_polls (event_id) VALUES ('event-poll')").run();
    expect(() => database.prepare("UPDATE event_polls SET event_id = 'event-a' WHERE event_id = 'event-poll'").run())
      .toThrow(/poll settings require a poll event/i);
    expect(() => database.prepare("UPDATE events SET type = 'other' WHERE id = 'event-poll'").run())
      .toThrow(/poll settings require a poll event/i);
  });

  it("keeps active guild-war roster identities inside their original aggregate", () => {
    const database = migratedDatabase();
    const insertUser = database.prepare(
      "INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)",
    );
    insertUser.run("creator-1", "Creator", "creator-revision-0001");
    insertUser.run("member-1", "Member", "member-revision-0001");
    const insertEvent = database.prepare(`INSERT INTO events (id, type, title, start_at, created_by)
      VALUES (?, 'other', ?, '2026-08-10T12:00:00.000Z', 'creator-1')`);
    insertEvent.run("event-a", "Event A");
    insertEvent.run("event-b", "Event B");
    database.prepare(`INSERT INTO event_participants (id, event_id, user_id)
      VALUES ('participant-a', 'event-a', 'member-1'), ('participant-b', 'event-b', 'member-1')`).run();
    const insertActive = database.prepare(`INSERT INTO guild_wars (
      id, event_id, status, war_name, created_by
    ) VALUES (?, ?, 'active', ?, 'creator-1')`);
    insertActive.run("war-active-a", "event-a", "Active A");
    insertActive.run("war-active-b", "event-b", "Active B");
    database.prepare(`INSERT INTO guild_wars (
      id, status, war_name, result, concluded_at, created_by
    ) VALUES ('war-concluded', 'concluded', 'Concluded', 'win',
      '2026-08-09T12:00:00.000Z', 'creator-1')`).run();
    database.prepare("INSERT INTO war_teams (id, war_id, team_name, sort_order) VALUES ('team-a', 'war-active-a', 'Alpha', 0)")
      .run();
    database.prepare(`INSERT INTO war_members (id, war_id, team_id, user_id)
      VALUES ('war-member-a', 'war-active-a', 'team-a', 'member-1')`).run();

    database.prepare("UPDATE war_teams SET team_name = 'Renamed' WHERE id = 'team-a'").run();
    expect(() => database.prepare("UPDATE war_teams SET war_id = 'war-concluded' WHERE id = 'team-a'").run())
      .toThrow(/roster is immutable/i);
    expect(() => database.prepare("UPDATE war_teams SET war_id = 'war-active-b' WHERE id = 'team-a'").run())
      .toThrow(/roster is immutable/i);
    expect(() => database.prepare(`UPDATE war_members
      SET war_id = 'war-active-b', team_id = NULL WHERE id = 'war-member-a'`).run())
      .toThrow(/roster is immutable/i);
  });

  it("enforces the shared per-event participant and raffle winner bound", () => {
    const database = migratedDatabase();
    const max = LIMITS.content.eventParticipantsPerEvent.max;
    database.exec(`WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < ${max + 1}
      )
      INSERT INTO users (id, username, role_id, revision_token)
      SELECT printf('bounded-user-%04d', value), printf('bounded_user_%04d', value), 'member',
        printf('bounded-revision-%04d', value)
      FROM sequence;`);
    database.prepare(`INSERT INTO events (id, type, title, start_at, end_at, created_by)
      VALUES ('bounded-event', 'other', 'Bounded event', '2099-01-01T00:00:00.000Z',
        '2099-01-02T00:00:00.000Z', 'bounded-user-0000')`).run();
    database.exec(`WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ${max}
      )
      INSERT INTO event_participants (id, event_id, user_id)
      SELECT printf('bounded-participant-%04d', value), 'bounded-event', printf('bounded-user-%04d', value)
      FROM sequence;`);

    expect(() => database.prepare(`INSERT INTO event_participants (id, event_id, user_id)
      VALUES ('bounded-participant-overflow', 'bounded-event', ?)`)
      .run(`bounded-user-${String(max + 1).padStart(4, "0")}`)).toThrow(/event signup is unavailable/i);
    expect(() => database.prepare(`INSERT INTO events (
      id, type, title, start_at, capacity, created_by
    ) VALUES ('capacity-overflow', 'other', 'Overflow', '2099-01-01T00:00:00.000Z', ?, 'bounded-user-0000')`)
      .run(max + 1)).toThrow(/events_capacity_bounded/i);
    expect(() => database.prepare(`INSERT INTO events (
      id, type, title, start_at, end_at, winner_count, created_by
    ) VALUES ('winner-overflow', 'raffle', 'Overflow', '2099-01-01T00:00:00.000Z',
      '2099-01-02T00:00:00.000Z', ?, 'bounded-user-0000')`)
      .run(max + 1)).toThrow(/events_winner_count_bounded/i);
  });

  it("keeps shared media attached until its final target is removed and freezes link identity", () => {
    const database = migratedDatabase();
    const insertUser = database.prepare(
      "INSERT INTO users (id, username, role_id, revision_token) VALUES (?, ?, 'member', ?)",
    );
    insertUser.run("member-1", "MemberOne", "member-one-revision-0001");
    insertUser.run("member-2", "MemberTwo", "member-two-revision-0001");
    const insertProfile = database.prepare(
      "INSERT INTO member_profiles (user_id, revision_token) VALUES (?, ?)",
    );
    insertProfile.run("member-1", "profile-one-revision-0001");
    insertProfile.run("member-2", "profile-two-revision-0001");
    const insertAsset = database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at
    ) VALUES (?, 'member-1', 'member_image', 'image', 'staged', '2026-08-10T00:00:00.000Z')`);
    insertAsset.run("media_asset_000000001");
    insertAsset.run("media_asset_000000002");
    const insertLink = database.prepare(`INSERT INTO media_links (
      media_id, entity_type, entity_id, slot, audience, sort_order
    ) VALUES ('media_asset_000000001', 'member_profile', ?, 'image', 'authenticated', 0)`);
    insertLink.run("member-1");
    insertLink.run("member-2");

    expect(scalarText(database, "SELECT state FROM media_assets WHERE id = 'media_asset_000000001'")).toBe("attached");
    expect(() => database.prepare(`UPDATE media_links SET media_id = 'media_asset_000000002'
      WHERE entity_type = 'member_profile' AND entity_id = 'member-1' AND slot = 'image'`).run())
      .toThrow(/target is immutable/i);
    database.prepare("DELETE FROM media_links WHERE entity_id = 'member-1'").run();
    expect(scalarText(database, "SELECT state FROM media_assets WHERE id = 'media_asset_000000001'")).toBe("attached");
    database.prepare("DELETE FROM media_links WHERE entity_id = 'member-2'").run();
    expect(scalarText(database, "SELECT state FROM media_assets WHERE id = 'media_asset_000000001'")).toBe("deleting");
  });
});

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  database.exec(migration);
  return database;
}

function values(database: DatabaseSync, sql: string, ...params: string[]): string[] {
  return database.prepare(sql).all(...params).map((row) => String(Object.values(row)[0]));
}

function scalarText(database: DatabaseSync, sql: string): string {
  const row = database.prepare(sql).get();
  return String(Object.values(row!)[0]);
}

class CapturingExecutor implements SqlExecutor {
  readonly executed: SqlStatement[] = [];
  readonly batches: SqlBatchStatement[][] = [];

  constructor(private readonly delegate: SqlExecutor) {}

  execute(statement: SqlStatement): Promise<SqlResult> {
    this.executed.push(statement);
    return this.delegate.execute(statement);
  }

  batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    this.batches.push([...statements]);
    return this.delegate.batch(statements);
  }
}

function expectPlan(database: DatabaseSync, statement: SqlStatement | undefined, indexName: string): void {
  if (!statement) throw new Error(`Expected SQL statement for ${indexName}`);
  const params = [...(statement.params ?? [])] as SQLInputValue[];
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...params) as Array<{ detail: string }>;
  const detail = plan.map((row) => row.detail).join("\n");
  expect(detail).toContain(indexName);
  expect(detail).not.toContain("USE TEMP B-TREE");
}
