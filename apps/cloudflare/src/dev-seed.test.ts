import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

const migrationManifest = JSON.parse(readFileSync(resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated/manifest.json",
), "utf8")) as Array<{ file: string }>;
const migrationStatements = migrationManifest.flatMap(({ file }) => statements(readFileSync(resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated",
  file,
), "utf8")));
const seedStatements = statements(readFileSync(resolve(process.cwd(), "scripts/dev/seed.sql"), "utf8"));

describe("Cloudflare local development seed", () => {
  it("repairs an expired partial seed and remains idempotent", async () => {
    const miniflare = new Miniflare({
      port: 0,
      workers: [{
        config: {
          name: "development-seed",
          type: "worker",
          compatibilityDate: "2026-07-28",
          manifest: {
            mainModule: "script-0.mjs",
            modules: {
              "script-0.mjs": { type: "esm", contents: "export default {}" },
            },
          },
          env: { DB: { type: "d1", id: "development-seed" } },
        },
      }],
    });
    try {
      const database = await miniflare.getD1Database("DB");
      await execute(database, migrationStatements);

      const participantInsert = seedStatements.findIndex((statement) => (
        statement.includes("INSERT OR IGNORE INTO event_participants")
      ));
      expect(participantInsert).toBeGreaterThan(0);
      await execute(database, seedStatements.slice(0, participantInsert));
      await database.prepare(`
        UPDATE user_credentials
        SET password_hash = 'pbkdf2-sha256$600000$aW5maW5pLWUyZS1vd25lcg$sZCPwQuC_-JxiVos8xhqUWE8XDoYzIfiG1krPbfO31I'
        WHERE user_id IN ('dev-owner', 'dev-member-01')
      `).run();
      await database.prepare(`
        UPDATE events
        SET start_at = '2026-01-01T00:00:00.000Z',
            end_at = '2026-01-01T01:00:00.000Z'
        WHERE id LIKE 'dev-event-%'
      `).run();

      await execute(database, seedStatements);
      const first = await snapshot(database);
      await execute(database, seedStatements);

      expect(await snapshot(database)).toEqual(first);
      expect(first).toMatchObject({
        events: 18,
        participants: 280,
        guildWars: 12,
        concludedWars: 10,
        activeWarEndsInFuture: 1,
        announcementCategories: 4,
        announcementViewCounts: 4,
        viewedWikiArticles: 4,
        wikiViewCounts: 4,
        galleryLikes: 7,
        nonDefaultCredentialCosts: 0,
      });
    } finally {
      await miniflare.dispose();
    }
  }, 45_000);
});

type DevelopmentDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

async function execute(database: DevelopmentDatabase, sql: readonly string[]): Promise<void> {
  for (let offset = 0; offset < sql.length; offset += 50) {
    await database.batch(sql.slice(offset, offset + 50).map((statement) => database.prepare(statement)));
  }
}

async function snapshot(database: DevelopmentDatabase): Promise<Record<string, number>> {
  const row = await database.prepare(`
    SELECT
      (SELECT count(*) FROM events WHERE id LIKE 'dev-event-%') AS events,
      (SELECT count(*) FROM event_participants WHERE id LIKE 'dev-participant-%') AS participants,
      (SELECT count(*) FROM guild_wars WHERE id LIKE 'dev-war-%') AS guildWars,
      (SELECT count(*) FROM guild_wars WHERE id LIKE 'dev-war-%' AND status = 'concluded') AS concludedWars,
      (SELECT count(DISTINCT category) FROM announcements
        WHERE id LIKE 'dev-announcement-%') AS announcementCategories,
      (SELECT count(DISTINCT view_count) FROM announcements
        WHERE id LIKE 'dev-announcement-%') AS announcementViewCounts,
      (SELECT count(*) FROM wiki_articles
        WHERE id LIKE 'dev-wiki-article-%' AND view_count > 0) AS viewedWikiArticles,
      (SELECT count(DISTINCT view_count) FROM wiki_articles
        WHERE id LIKE 'dev-wiki-article-%') AS wikiViewCounts,
      (SELECT count(*) FROM gallery_likes
        WHERE item_id LIKE 'dev-gallery-%') AS galleryLikes,
      (SELECT count(*) FROM user_credentials
        WHERE user_id LIKE 'dev-%'
          AND password_hash NOT LIKE 'pbkdf2-sha256$10000$%') AS nonDefaultCredentialCosts,
      (SELECT count(*) FROM events
        WHERE id = 'dev-event-war-active'
          AND archived_at IS NULL
          AND end_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS activeWarEndsInFuture
  `).first<Record<string, number>>();
  if (!row) throw new Error("Development seed snapshot is unavailable");
  return row;
}

function statements(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}
