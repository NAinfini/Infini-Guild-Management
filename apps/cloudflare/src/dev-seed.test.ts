import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

const migrationStatements = statements(readFileSync(resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
), "utf8"));
const seedStatements = statements(readFileSync(resolve(process.cwd(), "scripts/dev/seed.sql"), "utf8"));

describe("Cloudflare local development seed", () => {
  it("repairs an expired partial seed and remains idempotent", async () => {
    const miniflare = new Miniflare({
      compatibilityDate: "2026-07-28",
      d1Databases: { DB: "development-seed" },
      modules: true,
      port: 0,
      script: "export default {}",
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
        events: 10,
        participants: 46,
        guildWars: 4,
        concludedWars: 3,
        activeWarEndsInFuture: 1,
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
