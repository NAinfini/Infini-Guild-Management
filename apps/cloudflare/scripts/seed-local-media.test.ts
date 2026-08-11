import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { DEVELOPMENT_MEDIA_OBJECTS } from "../../../scripts/dev/media-fixtures.mjs";
import {
  LOCAL_D1_DATABASE_ID,
  LOCAL_R2_BUCKET_NAME,
  seedCloudflareLocalMedia,
} from "./seed-local-media.js";

const migrationStatements = statements(readFileSync(path.resolve(
  process.cwd(),
  "packages/persistence-sqlite/src/migrations/generated/0000_core.sql",
), "utf8"));
const relationalSeedStatements = statements(readFileSync(path.resolve(process.cwd(), "scripts/dev/seed.sql"), "utf8"));

const states: string[] = [];

afterEach(async () => {
  await Promise.all(states.splice(0).map((state) => rm(state, { recursive: true, force: true })));
});

describe("Cloudflare local media seed", () => {
  it("leaves local R2 untouched without the development owner", async () => {
    const state = await localState();
    await prepareDatabase(state, false);
    await expect(seedCloudflareLocalMedia({ persistTo: state })).resolves.toEqual({
      result: "skipped",
      media: null,
    });
    const inspector = createMiniflare(state);
    try {
      expect((await (await inspector.getR2Bucket("BLOBS")).list({ prefix: "media/" })).objects).toHaveLength(0);
    } finally {
      await inspector.dispose();
    }
  });

  it("writes, verifies, and repairs the exact R2 objects in its local persistence directory", async () => {
    const state = await localState();
    await prepareDatabase(state, true);

    await expect(seedCloudflareLocalMedia({ persistTo: state })).resolves.toEqual({
      result: "applied",
      media: { processed: DEVELOPMENT_MEDIA_OBJECTS.length, total: DEVELOPMENT_MEDIA_OBJECTS.length },
    });

    const removed = DEVELOPMENT_MEDIA_OBJECTS[0]!;
    const mutator = createMiniflare(state);
    try {
      await (await mutator.getR2Bucket("BLOBS")).delete(removed.objectKey);
      const database = await mutator.getD1Database("DB");
      await database.prepare("DELETE FROM media_links WHERE media_id = 'dev-media-00000000021'").run();
      await expect(database.prepare(
        "SELECT state FROM media_assets WHERE id = 'dev-media-00000000021'",
      ).first()).resolves.toEqual({ state: "deleting" });
    } finally {
      await mutator.dispose();
    }

    await expect(seedCloudflareLocalMedia({ persistTo: state })).resolves.toEqual({
      result: "applied",
      media: { processed: DEVELOPMENT_MEDIA_OBJECTS.length, total: DEVELOPMENT_MEDIA_OBJECTS.length },
    });

    const inspector = createMiniflare(state);
    try {
      const bucket = await inspector.getR2Bucket("BLOBS");
      expect((await bucket.list({ prefix: "media/" })).objects).toHaveLength(DEVELOPMENT_MEDIA_OBJECTS.length);
      for (const object of DEVELOPMENT_MEDIA_OBJECTS) {
        await expect(bucket.head(object.objectKey)).resolves.toMatchObject({
          key: object.objectKey,
          size: object.byteSize,
          httpMetadata: { contentType: object.contentType },
          customMetadata: { sha256: object.sha256 },
        });
      }
      const database = await inspector.getD1Database("DB");
      await expect(database.prepare(`
        SELECT
          (SELECT count(*) FROM media_assets) AS assets,
          (SELECT count(*) FROM media_variants) AS variants,
          (SELECT count(*) FROM media_links) AS links,
          (SELECT count(*) FROM wiki_revision_media WHERE revision_id LIKE 'dev-revision-war-playbook-%') AS wikiRevisionMedia,
          (SELECT count(*) FROM wiki_revision_media
            WHERE revision_id LIKE 'dev-revision-war-playbook-%' AND audience = 'private') AS privateWikiRevisionMedia,
          (SELECT state FROM media_assets WHERE id = 'dev-media-00000000021') AS repairedLinkState,
          (SELECT count(*) FROM media_links WHERE media_id = 'dev-media-00000000021') AS repairedLinkCount,
          (SELECT site_logo_media_id FROM site_config WHERE singleton = 1) AS siteLogo,
          (SELECT icon_type || ':' || coalesce(vector_icon, 'null') FROM class_catalog WHERE id = 'dev-class-vanguard') AS classIcon
      `).first()).resolves.toEqual({
        assets: 23,
        variants: 45,
        links: 23,
        wikiRevisionMedia: 3,
        privateWikiRevisionMedia: 3,
        repairedLinkState: "attached",
        repairedLinkCount: 1,
        siteLogo: "dev-media-00000000001",
        classIcon: "image:null",
      });
    } finally {
      await inspector.dispose();
    }
  }, 60_000);

  it("fails instead of replacing an incompatible existing local R2 object", async () => {
    const state = await localState();
    await prepareDatabase(state, true);
    const object = DEVELOPMENT_MEDIA_OBJECTS[10]!;
    const mutator = createMiniflare(state);
    try {
      await (await mutator.getR2Bucket("BLOBS")).put(object.objectKey, new Uint8Array([0]), {
        httpMetadata: { contentType: object.contentType },
        customMetadata: { sha256: "0".repeat(64) },
      });
    } finally {
      await mutator.dispose();
    }

    await expect(seedCloudflareLocalMedia({ persistTo: state }))
      .rejects.toThrow(/already exists with different metadata/i);

    const inspector = createMiniflare(state);
    try {
      const objects = (await (await inspector.getR2Bucket("BLOBS")).list({ prefix: "media/" })).objects;
      expect(objects.map((entry) => entry.key)).toEqual([object.objectKey]);
      await expect((await inspector.getD1Database("DB")).prepare(
        "SELECT count(*) AS count FROM media_assets",
      ).first()).resolves.toEqual({ count: 0 });
    } finally {
      await inspector.dispose();
    }
  });
});

async function localState(): Promise<string> {
  const state = await mkdtemp(path.join(tmpdir(), "guild-cloudflare-media-"));
  states.push(state);
  return state;
}

async function prepareDatabase(state: string, seed: boolean): Promise<void> {
  const miniflare = createMiniflare(state);
  try {
    const database = await miniflare.getD1Database("DB");
    await execute(database, migrationStatements);
    if (seed) await execute(database, relationalSeedStatements);
  } finally {
    await miniflare.dispose();
  }
}

function createMiniflare(state: string): Miniflare {
  return new Miniflare({
    compatibilityDate: "2026-07-28",
    d1Databases: { DB: LOCAL_D1_DATABASE_ID },
    r2Buckets: { BLOBS: LOCAL_R2_BUCKET_NAME },
    resourcePersistencePath: state,
    modules: true,
    script: "export default {}",
  });
}

type DevelopmentDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

async function execute(database: DevelopmentDatabase, sql: readonly string[]): Promise<void> {
  for (let offset = 0; offset < sql.length; offset += 50) {
    await database.batch(sql.slice(offset, offset + 50).map((statement) => database.prepare(statement)));
  }
}

function statements(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}
