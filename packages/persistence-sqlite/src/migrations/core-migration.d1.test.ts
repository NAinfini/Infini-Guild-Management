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

function createD1Miniflare(databaseId: string): Miniflare {
  return new Miniflare({
    port: 0,
    workers: [{
      config: {
        name: "core-migration-test",
        type: "worker",
        compatibilityDate: "2026-07-28",
        manifest: {
          mainModule: "script-0.mjs",
          modules: {
            "script-0.mjs": { type: "esm", contents: "export default {}" },
          },
        },
        env: { DB: { type: "d1", id: databaseId } },
      },
    }],
  });
}

describe("core migration on Miniflare workerd D1", () => {
  it("applies the complete migration through the real D1 binding", async () => {
    const miniflare = createD1Miniflare("core-migration-smoke");
    try {
      const database = await miniflare.getD1Database("DB");
      for (const { entry, sql } of migrations) {
        expect(createHash("sha256").update(canonicalMigrationPayload(sql)).digest("hex"))
          .toBe(entry.checksum);
        await applyD1Migration(database, sql);
      }

      expect(await database.prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_'",
      ).first<number>("count")).toBe(68);
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
  await new SqliteGalleryStore(gallerySql).list({ cursor: null, limit: 24, order: "desc", viewerUserId: null });
  const galleryStatement = gallerySql.executed[0];
  if (!galleryStatement) throw new Error("Gallery list did not execute SQL");
  const galleryPlan = await explainD1(database, galleryStatement);
  expect(galleryPlan).toContain("idx_gallery_items_created");
  expect(galleryPlan).not.toContain("USE TEMP B-TREE");

  await new SqliteGalleryStore(gallerySql).list({ cursor: null, limit: 24, order: "desc", type: "image", viewerUserId: null });
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
    readScope: { kind: "public" },
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
      readScope: { kind: "all" },
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
