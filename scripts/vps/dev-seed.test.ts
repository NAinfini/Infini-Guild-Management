import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemBlobStore } from "@guild/vps/adapters";
import { DEVELOPMENT_MEDIA_OBJECTS } from "../dev/media-fixtures.mjs";
import { runVpsMigration } from "./migrate-vps";
import { seedLocalVps } from "./seed-vps";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "infini-dev-seed-"));
  temporaryDirectories.push(directory);
  const target = path.join(directory, "guild.sqlite");
  await runVpsMigration(["--database", target]);
  return target;
}

describe("shared local development seed", () => {
  it("populates a fresh VPS database and remains idempotent", async () => {
    const target = await databasePath();

    await expect(seedLocalVps(["--database", target])).resolves.toMatchObject({
      result: "applied",
      media: { processed: DEVELOPMENT_MEDIA_OBJECTS.length, total: DEVELOPMENT_MEDIA_OBJECTS.length },
    });
    await expect(seedLocalVps(["--database", target])).resolves.toMatchObject({
      result: "current",
      media: { processed: DEVELOPMENT_MEDIA_OBJECTS.length, total: DEVELOPMENT_MEDIA_OBJECTS.length },
    });

    const repair = new DatabaseSync(target);
    try {
      repair.prepare(`UPDATE user_credentials
        SET password_hash = 'pbkdf2-sha256$600000$aW5maW5pLWUyZS1vd25lcg$sZCPwQuC_-JxiVos8xhqUWE8XDoYzIfiG1krPbfO31I'
        WHERE user_id IN ('dev-owner', 'dev-member-01')`).run();
      repair.prepare("DELETE FROM media_links WHERE media_id = 'dev-media-00000000021'").run();
      expect(repair.prepare(
        "SELECT state FROM media_assets WHERE id = 'dev-media-00000000021'",
      ).get()).toEqual({ state: "deleting" });
    } finally {
      repair.close();
    }
    await new FilesystemBlobStore(path.join(path.dirname(target), "blobs"))
      .delete(DEVELOPMENT_MEDIA_OBJECTS[0]!.objectKey);
    await expect(seedLocalVps(["--database", target])).resolves.toMatchObject({
      result: "current",
      media: { processed: DEVELOPMENT_MEDIA_OBJECTS.length, total: DEVELOPMENT_MEDIA_OBJECTS.length },
    });

    const database = new DatabaseSync(target, { readOnly: true });
    try {
      expect(count(database, "users")).toBe(32);
      expect(count(database, "class_catalog")).toBe(4);
      expect(count(database, "member_badges")).toBe(3);
      expect(count(database, "announcements")).toBe(5);
      expect(count(database, "events")).toBe(18);
      expect(count(database, "wiki_articles")).toBe(4);
      expect(count(database, "wiki_revisions")).toBe(6);
      expect(database.prepare(
        "SELECT count(DISTINCT category) AS count FROM announcements WHERE id LIKE 'dev-announcement-%'",
      ).get()).toEqual({ count: 4 });
      expect(database.prepare(
        "SELECT count(DISTINCT view_count) AS count FROM announcements WHERE id LIKE 'dev-announcement-%'",
      ).get()).toEqual({ count: 4 });
      expect(database.prepare(
        "SELECT count(*) AS count FROM wiki_articles WHERE id LIKE 'dev-wiki-article-%' AND view_count > 0",
      ).get()).toEqual({ count: 4 });
      expect(database.prepare(
        "SELECT count(DISTINCT view_count) AS count FROM wiki_articles WHERE id LIKE 'dev-wiki-article-%'",
      ).get()).toEqual({ count: 4 });
      expect(count(database, "gallery_likes")).toBe(7);
      expect(count(database, "storage_items")).toBe(4);
      expect(count(database, "guild_wars")).toBe(12);
      expect(database.prepare(
        "SELECT count(*) AS count FROM guild_wars WHERE status = 'concluded'",
      ).get()).toEqual({ count: 10 });
      expect(database.prepare(
        "SELECT quantity FROM storage_balances WHERE item_id = 'dev-storage-item-crystal'",
      ).get()).toEqual({ quantity: 252.5 });
      expect(database.prepare(
        "SELECT password_hash FROM user_credentials WHERE user_id = 'dev-owner'",
      ).get()).toEqual({
        password_hash: "pbkdf2-sha256$10000$aW5maW5pLWUyZS1vd25lcg$-VYi6RNWPNIdHw3hXNV9jsMaTTUvgCy-AqKVhQy7kVw",
      });
      expect(database.prepare(
        "SELECT count(*) AS count FROM user_credentials WHERE user_id LIKE 'dev-%' AND password_hash NOT LIKE 'pbkdf2-sha256$10000$%'",
      ).get()).toEqual({ count: 0 });
      expect(database.prepare(`
        SELECT state, (SELECT count(*) FROM media_links WHERE media_id = media_assets.id) AS links
        FROM media_assets
        WHERE id = 'dev-media-00000000021'
      `).get()).toEqual({ state: "attached", links: 1 });
    } finally {
      database.close();
    }

    const blobs = new FilesystemBlobStore(path.join(path.dirname(target), "blobs"), { createRoot: false });
    for (const object of DEVELOPMENT_MEDIA_OBJECTS) {
      await expect(blobs.head(object.objectKey)).resolves.toMatchObject({
        key: object.objectKey,
        size: object.byteSize,
        contentType: object.contentType,
        sha256: object.sha256,
      });
    }
  });

  it("does not add mock records to an existing site", async () => {
    const target = await databasePath();
    const database = new DatabaseSync(target);
    try {
      database.exec(`
        INSERT INTO users (
          id, display_name, role_id, is_active, deleted_at, revision_token, created_at, updated_at
        ) VALUES (
          'existing-owner', 'existing_owner', 'admin', 1, NULL,
          'existing-owner-revision', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
    } finally {
      database.close();
    }

    const blobPath = path.join(path.dirname(target), "not-created-blobs");
    await expect(seedLocalVps(["--database", target, "--blobs", blobPath])).resolves.toMatchObject({
      result: "skipped",
      media: null,
    });
    await expect(access(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
    const verification = new DatabaseSync(target, { readOnly: true });
    try {
      expect(count(verification, "users")).toBe(1);
      expect(count(verification, "events")).toBe(0);
    } finally {
      verification.close();
    }
  });

  it("rolls back the whole VPS seed when any statement fails", async () => {
    const target = await databasePath();
    const directory = path.dirname(target);
    const brokenSeed = path.join(directory, "broken-seed.sql");
    const validPrefix = (await readFile(new URL("../dev/seed.sql", import.meta.url), "utf8"))
      .split("INSERT OR IGNORE INTO user_credentials", 1)[0];
    await writeFile(brokenSeed, `${validPrefix}\nINSERT INTO missing_table VALUES (1);\n`, "utf8");

    await expect(seedLocalVps([
      "--database", target,
      "--seed", brokenSeed,
    ])).rejects.toThrow();

    const database = new DatabaseSync(target, { readOnly: true });
    try {
      expect(count(database, "users")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("fails rather than replacing a mismatched local development media object", async () => {
    const target = await databasePath();
    const blobPath = path.join(path.dirname(target), "blobs");
    const object = DEVELOPMENT_MEDIA_OBJECTS[10]!;
    const wrongBytes = new TextEncoder().encode("wrong development fixture");
    const blobs = new FilesystemBlobStore(blobPath);
    await blobs.putIfAbsent(object.objectKey, {
      body: bytesToStream(wrongBytes),
      size: wrongBytes.byteLength,
      contentType: object.contentType,
      sha256: createHash("sha256").update(wrongBytes).digest("hex"),
    });

    await expect(seedLocalVps(["--database", target, "--blobs", blobPath]))
      .rejects.toThrow(/already exists with different metadata/i);
    const inventory = await blobs.listPrefix({ prefix: "media/", limit: 1_000 });
    expect(inventory.objects.map((entry) => entry.key)).toEqual([object.objectKey]);
    expect(inventory.nextCheckpoint).toBeNull();
    const database = new DatabaseSync(target, { readOnly: true });
    try {
      expect(count(database, "users")).toBe(0);
      expect(count(database, "media_assets")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects incompatible immutable media metadata before writing blobs", async () => {
    const target = await databasePath();
    const database = new DatabaseSync(target);
    try {
      database.exec(await readFile(new URL("../dev/seed.sql", import.meta.url), "utf8"));
      database.prepare(`
        INSERT INTO media_assets (
          id, owner_user_id, purpose, media_type, state, original_name,
          expires_at, delete_claim_token, delete_claim_until
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `).run(
        "dev-media-00000000001",
        "dev-member-01",
        "site_logo",
        "image",
        "attached",
      );
    } finally {
      database.close();
    }

    const blobPath = path.join(path.dirname(target), "not-created-blobs");
    await expect(seedLocalVps(["--database", target, "--blobs", blobPath]))
      .rejects.toThrow(/incompatible assetMismatches/i);
    await expect(access(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function count(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
