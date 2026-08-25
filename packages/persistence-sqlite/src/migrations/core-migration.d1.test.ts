import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlStatement } from "@guild/kernel";
import { SqliteGalleryStore } from "../stores/gallery-store.js";
import { SqliteWikiStore } from "../stores/wiki-store.js";
import {
  APP_MIGRATION_LEDGER_MARKER,
  canonicalMigrationPayload,
} from "./migration-manifest.js";

type ManifestEntry = Readonly<{ id: string; ordinal: number; file: string; checksum: string }>;
const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("./generated/manifest.json", import.meta.url)),
  "utf8",
)) as ManifestEntry[];
const migrations = manifest.map((entry) => ({
  entry,
  sql: readFileSync(fileURLToPath(new URL(`./generated/${entry.file}`, import.meta.url)), "utf8"),
}));

describe("core migration on Miniflare workerd D1", () => {
  it("preserves an existing account exactly across the identity split", async () => {
    const miniflare = new Miniflare({
      compatibilityDate: "2026-07-28",
      d1Databases: { DB: "identity-upgrade-smoke" },
      modules: true,
      port: 0,
      script: "export default {}",
    });
    try {
      const database = await miniflare.getD1Database("DB");
      for (const { sql } of migrations.slice(0, 3)) await applyD1Migration(database, sql);
      await database.prepare(`INSERT INTO users (id, username, role_id, revision_token, created_at, updated_at)
        VALUES ('legacy-user', ?, 'member', 'legacy-user-revision-0001', ?, ?)`)
        .bind("Legacy.User", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z").run();
      await database.prepare(`INSERT INTO user_credentials (
        user_id, password_hash, temporary_password_expires_at, temporary_password_used_at, updated_at
      ) VALUES ('legacy-user', ?, ?, ?, ?)`)
        .bind("legacy-password-hash", "2026-08-22T12:15:00.000Z", null, "2026-08-01T00:00:00.000Z").run();
      await database.prepare(`INSERT INTO login_failures (username, fail_count, locked_until, last_failed_at)
        VALUES ('legacy.user', 4, '2026-08-22T12:05:00.000Z', '2026-08-22T12:00:00.000Z')`).run();

      for (const { sql } of migrations.slice(3)) await applyD1Migration(database, sql);

      expect(await database.prepare("SELECT display_name FROM users WHERE id = 'legacy-user'").first())
        .toEqual({ display_name: "Legacy.User" });
      expect(await database.prepare(`SELECT login_name, password_hash, temporary_password_expires_at,
        temporary_password_used_at FROM user_credentials WHERE user_id = 'legacy-user'`).first()).toEqual({
        login_name: "Legacy.User",
        password_hash: "legacy-password-hash",
        temporary_password_expires_at: "2026-08-22T12:15:00.000Z",
        temporary_password_used_at: null,
      });
      expect(await database.prepare(
        "SELECT fail_count, locked_until FROM login_failures WHERE login_name = 'legacy.user'",
      ).first()).toEqual({ fail_count: 4, locked_until: "2026-08-22T12:05:00.000Z" });
      expect((await database.prepare("PRAGMA table_info(users)").all()).results.map((row) => row.name))
        .not.toContain("username");
      expect(await database.prepare("SELECT count(*) AS count FROM external_identities").first<number>("count")).toBe(0);
      expect(await database.prepare("SELECT count(*) AS count FROM user_emails").first<number>("count")).toBe(0);
    } finally {
      await miniflare.dispose();
    }
  }, 45_000);

  it("upgrades an attached media graph through the real D1 binding", async () => {
    const miniflare = new Miniflare({
      compatibilityDate: "2026-07-28",
      d1Databases: { DB: "media-upgrade-smoke" },
      modules: true,
      port: 0,
      script: "export default {}",
    });
    try {
      const database = await miniflare.getD1Database("DB");
      for (const { sql } of migrations.slice(0, 7)) await applyD1Migration(database, sql);
      const now = "2026-08-09T12:00:00.000Z";
      const owner = "media-upgrade-owner";
      const announcement = "media-upgrade-announcement";
      const mediaId = "mmmmmmmmmmmmmmmmmmmmm";
      await database.prepare("INSERT INTO users (id, display_name, role_id, revision_token) VALUES (?, ?, 'member', ?)")
        .bind(owner, "Media owner", "media-upgrade-owner-revision").run();
      await database.prepare(`INSERT INTO announcements (
        id, title, body_json, pinned, status, publish_at, created_by, revision_token, created_at, updated_at
      ) VALUES (?, 'Notice', '{"type":"doc","content":[]}', 0, 'published', ?, ?, ?, ?, ?)`)
        .bind(announcement, now, owner, "media-upgrade-announcement-revision", now, now).run();
      await database.prepare(`INSERT INTO media_assets (
        id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
      ) VALUES (?, ?, 'announcement_image', 'image', 'staged', ?, ?, ?)`)
        .bind(mediaId, owner, "2026-08-10T12:00:00.000Z", now, now).run();
      await database.prepare(`INSERT INTO media_variants (
        media_id, variant, object_key, content_type, byte_size, sha256, width, height
      ) VALUES (?, 'full', 'media/upgrade/full.webp', 'image/webp', 10, ?, 1, 1)`)
        .bind(mediaId, "a".repeat(64)).run();
      await database.prepare(`INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
        VALUES (?, 'announcement', ?, 'body', 'public', 0)`).bind(mediaId, announcement).run();

      await applyD1Migration(database, migrations[7]!.sql);

      expect(await database.prepare("SELECT state FROM media_assets WHERE id = ?").bind(mediaId).first())
        .toEqual({ state: "attached" });
      expect(await database.prepare("SELECT count(*) AS count FROM media_links WHERE media_id = ?").bind(mediaId).first())
        .toEqual({ count: 1 });
      expect(await database.prepare(`SELECT max_announcement_attachment_bytes, quota_announcement_attachments
        FROM site_config WHERE singleton = 1`).first()).toEqual({
        max_announcement_attachment_bytes: 10 * 1024 * 1024,
        quota_announcement_attachments: 5,
      });
      expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    } finally {
      await miniflare.dispose();
    }
  }, 45_000);

  it("applies the complete migration through the real D1 binding", async () => {
    const miniflare = new Miniflare({
      compatibilityDate: "2026-07-28",
      d1Databases: { DB: "core-migration-smoke" },
      modules: true,
      port: 0,
      script: "export default {}",
    });
    try {
      const database = await miniflare.getD1Database("DB");
      for (const { entry, sql } of migrations) {
        expect(createHash("sha256").update(canonicalMigrationPayload(sql)).digest("hex"))
          .toBe(entry.checksum);
        await applyD1Migration(database, sql);
      }

      expect(await database.prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_'",
      ).first<number>("count")).toBe(66);
      expect(await database.prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger'",
      ).first<number>("count")).toBeGreaterThan(51);
      expect((await database.prepare(
        "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal",
      ).all()).results).toEqual(manifest.map(({ id, ordinal, checksum }) => ({ id, ordinal, checksum })));
      expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
      await expect(database.prepare(
        "UPDATE app_migrations SET checksum = ? WHERE ordinal = 0",
      ).bind("0".repeat(64)).run()).rejects.toThrow(/append-only/i);
      await expect(database.prepare("DELETE FROM app_migrations WHERE ordinal = 0").run())
        .rejects.toThrow(/append-only/i);

      const fixtureOrdinal = manifest.length;
      const fixtureId = `${String(fixtureOrdinal).padStart(4, "0")}_fixture`;
      const fixturePayload = "CREATE TABLE d1_migration_fixture (value TEXT NOT NULL);\n--> statement-breakpoint\n";
      const fixtureChecksum = createHash("sha256").update(fixturePayload).digest("hex");
      const fixtureSql = `${fixturePayload}${APP_MIGRATION_LEDGER_MARKER}\n`
        + `INSERT INTO app_migrations (id, ordinal, checksum) VALUES ('${fixtureId}', ${fixtureOrdinal}, '${fixtureChecksum}');\n`;
      await applyD1Migration(database, fixtureSql);
      expect((await database.prepare(
        "SELECT id, ordinal, checksum FROM app_migrations ORDER BY ordinal",
      ).all()).results).toEqual([
        ...manifest.map(({ id, ordinal, checksum }) => ({ id, ordinal, checksum })),
        { id: fixtureId, ordinal: fixtureOrdinal, checksum: fixtureChecksum },
      ]);

      await expectHotPathPlans(database);
    } finally {
      await miniflare.dispose();
    }
  }, 45_000);
});

async function applyD1Migration(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  sql: string,
): Promise<void> {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (let offset = 0; offset < statements.length; offset += 50) {
    await database.batch(statements.slice(offset, offset + 50).map((statement) => database.prepare(statement)));
  }
}

class StatementCaptureExecutor implements SqlExecutor {
  readonly executed: SqlStatement[] = [];
  readonly batches: SqlBatchStatement[][] = [];

  async execute(statement: SqlStatement): Promise<SqlResult> {
    this.executed.push(statement);
    return { rows: statement.method === "get" ? undefined : [] };
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    this.batches.push([...statements]);
    return statements.map((statement) => ({
      rows: statement.method === "get" && statement.columns?.[0] === "total" ? [0] : [],
    }));
  }
}

async function expectHotPathPlans(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
): Promise<void> {
  const rosterPlan = await explainD1(database, {
    method: "all",
    sql: `SELECT users.id FROM users
      INNER JOIN roles ON users.role_id = roles.id
      INNER JOIN member_profiles ON member_profiles.user_id = users.id
      WHERE users.deleted_at IS NULL
      ORDER BY users.created_at, users.id LIMIT ? OFFSET ?`,
    params: [500, 0],
  });
  expect(rosterPlan).toContain("idx_users_roster_all");
  expect(rosterPlan).not.toContain("USE TEMP B-TREE");

  const gallerySql = new StatementCaptureExecutor();
  await new SqliteGalleryStore(gallerySql).list({ cursor: null, limit: 24, order: "desc" });
  const galleryStatement = gallerySql.executed[0];
  if (!galleryStatement) throw new Error("Gallery list did not execute SQL");
  const galleryPlan = await explainD1(database, galleryStatement);
  expect(galleryPlan).toContain("idx_gallery_items_created");
  expect(galleryPlan).not.toContain("USE TEMP B-TREE");

  await new SqliteGalleryStore(gallerySql).list({ cursor: null, limit: 24, order: "desc", type: "image" });
  const galleryTypeStatement = gallerySql.executed.at(-1);
  if (!galleryTypeStatement) throw new Error("Filtered gallery list did not execute SQL");
  const galleryTypePlan = await explainD1(database, galleryTypeStatement);
  expect(galleryTypePlan).toContain("idx_gallery_items_type_created");
  expect(galleryTypePlan).not.toContain("USE TEMP B-TREE");

  const wikiSql = new StatementCaptureExecutor();
  await new SqliteWikiStore(wikiSql).listArticles({
    page: 1,
    limit: 50,
    categoryIds: [],
    sort: "curated",
    canReadArchived: false,
  });
  const wikiStatement = wikiSql.batches[0]?.[1];
  if (!wikiStatement) throw new Error("Wiki article list did not execute SQL");
  const wikiPlan = await explainD1(database, wikiStatement);
  expect(wikiPlan).toContain("idx_wiki_articles_public_curated");
  expect(wikiPlan).not.toContain("USE TEMP B-TREE");

  const managementVariants = [
    ["curated", "idx_wiki_articles_admin_curated"],
    ["updated_desc", "idx_wiki_articles_admin_updated"],
    ["updated_asc", "idx_wiki_articles_admin_updated"],
  ] as const;
  for (const [sort, indexName] of managementVariants) {
    await new SqliteWikiStore(wikiSql).listArticles({
      page: 1,
      limit: 50,
      categoryIds: [],
      sort,
      canReadArchived: true,
    });
    const statement = wikiSql.batches.at(-1)?.[1];
    if (!statement) throw new Error(`Wiki ${sort} list did not execute SQL`);
    const plan = await explainD1(database, statement);
    expect(plan).toContain(indexName);
    expect(plan).not.toContain("USE TEMP B-TREE");
  }
}

async function explainD1(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  statement: SqlStatement,
): Promise<string> {
  const params = (statement.params ?? []).map((value) => value instanceof Uint8Array ? value.buffer : value);
  const result = await database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).bind(...params).all<{ detail: string }>();
  return result.results.map(({ detail }) => detail).join("\n");
}
