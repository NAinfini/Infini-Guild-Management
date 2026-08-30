import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaReservation } from "@guild/server/modules/media";
import type { BlobStore } from "@guild/kernel";
import { createAuthorizationContext, createRequestContext, MAX_SQL_BATCH_STATEMENTS } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";
import { createSchedulerAuditFactory } from "@guild/server/modules/jobs";
import { SystemTestService } from "@guild/server/modules/system-test";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { assertMediaAttachments } from "./media-link-statements.js";
import { SqliteMediaStore } from "./media-store.js";
import { SqliteSystemTestArtifactCleaner } from "./system-test-artifact-cleaner.js";
import { SqliteSystemTestStore } from "./system-test-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const MEDIA_ID = "abcdefghijklmnopqrstu";
const SECOND_MEDIA_ID = "vwxyzabcdefghijklmnop";
const PUBLIC_SCOPE = { kind: "public" } as const;
const PUBLIC_CONTENT_SCOPES = { announcement: PUBLIC_SCOPE, wikiArticle: PUBLIC_SCOPE } as const;
const WIKI_REVISION_MEDIA_TABLE = `CREATE TABLE IF NOT EXISTS wiki_revision_media (
  revision_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  audience TEXT NOT NULL
)`;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteMediaStore shared asset links", () => {
  it("keeps a shared asset attached until its final target is removed", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.exec(WIKI_REVISION_MEDIA_TABLE);
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
    database.prepare(`INSERT INTO recurring_templates (
      id, type, title, start_time, recurrence_frequency, recurrence_interval, created_by
    ) VALUES ('template-1', 'other', 'Template', '12:00', 'weekly', 1, 'owner-1')`).run();
    database.prepare(`INSERT INTO events (id, type, title, start_at, created_by)
      VALUES ('event-1', 'other', 'Event', ?, 'owner-1')`).run(NOW);
    database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'owner-1', 'event_image', 'image', 'staged', ?, ?, ?)`)
      .run(MEDIA_ID, "2026-08-10T12:00:00.000Z", NOW, NOW);
    database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`)
      .run(MEDIA_ID, `media/${MEDIA_ID}/view.webp`, "a".repeat(64));

    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'recurring_template', 'template-1', 'attachment', 'private', 0)`)
      .run(MEDIA_ID);
    const sql = new SqliteTestExecutor(database);
    await expect(assertMediaAttachments(sql, {
      actorUserId: "owner-1",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "event_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).resolves.toEqual([MEDIA_ID]);
    await expect(assertMediaAttachments(sql, {
      actorUserId: "other-user",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "event_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertMediaAttachments(sql, {
      actorUserId: "owner-1",
      entityType: "event",
      entityId: "event-1",
      slot: "attachment",
      purpose: "announcement_image",
      audience: "public",
      mediaIds: [MEDIA_ID],
      maxItems: 1,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() => database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'announcement', 'announcement-1', 'body', 'private', 0)`).run(MEDIA_ID))
      .toThrow("media purpose does not support target");
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'event', 'event-1', 'attachment', 'public', 0)`)
      .run(MEDIA_ID);

    const store = new SqliteMediaStore(sql);
    const publicFacts = await store.describeRead(MEDIA_ID, "view", NOW, PUBLIC_CONTENT_SCOPES);
    expect(publicFacts).toMatchObject({
      objectKey: `media/${MEDIA_ID}/view.webp`,
      byteSize: 10,
      contentType: "image/webp",
      sha256: "a".repeat(64),
      audience: "public",
      ownerUserId: "owner-1",
    });
    expect(new Set(publicFacts?.entityTypes)).toEqual(new Set(["recurring_template", "event"]));

    database.prepare("DELETE FROM media_links WHERE entity_type = 'event' AND entity_id = 'event-1'").run();
    expect(database.prepare("SELECT state FROM media_assets WHERE id = ?").get(MEDIA_ID))
      .toMatchObject({ state: "attached" });
    expect((await store.describeRead(MEDIA_ID, "view", NOW, PUBLIC_CONTENT_SCOPES))?.audience).toBe("private");

    database.prepare("DELETE FROM media_links WHERE entity_type = 'recurring_template'").run();
    expect(database.prepare("SELECT state FROM media_assets WHERE id = ?").get(MEDIA_ID))
      .toMatchObject({ state: "deleting" });
  });

  it("derives private announcement and wiki media readability from the parent author", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token) VALUES
      ('author-a', 'Author A', 'member', 'author-a-revision-0001'),
      ('author-b', 'Author B', 'member', 'author-b-revision-0001')`).run();
    database.prepare(`INSERT INTO announcements (
      id, title, body_json, pinned, status, created_by, revision_token, created_at, updated_at
    ) VALUES ('announcement-b', 'Draft B', '{"type":"doc","content":[]}', 0, 'draft',
      'author-b', 'announcement-b-revision', ?, ?)`).run(NOW, NOW);
    database.prepare(`INSERT INTO wiki_categories (id, name, slug, revision_token)
      VALUES ('category-1', 'Root', 'root', 'category-revision-1')`).run();
    database.prepare(`INSERT INTO wiki_articles (
      id, title, slug, category_id, body_json, sort_order, pinned, archived_at,
      created_by, current_revision, revision_token, created_at, updated_at
    ) VALUES ('wiki-b', 'Archived B', 'archived-b', 'category-1', '{"type":"doc","content":[]}',
      0, 0, ?, 'author-b', 1, 'wiki-b-revision-0001', ?, ?)`).run(NOW, NOW, NOW);
    const insertAsset = database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'author-b', ?, 'image', 'staged', '2026-08-10T12:00:00.000Z', ?, ?)`);
    const insertVariant = database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`);
    insertAsset.run(MEDIA_ID, "announcement_image", NOW, NOW);
    insertVariant.run(MEDIA_ID, `media/${MEDIA_ID}/view.webp`, "a".repeat(64));
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'announcement', 'announcement-b', 'body', 'private', 0)`).run(MEDIA_ID);
    insertAsset.run(SECOND_MEDIA_ID, "wiki_image", NOW, NOW);
    insertVariant.run(SECOND_MEDIA_ID, `media/${SECOND_MEDIA_ID}/view.webp`, "b".repeat(64));
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'wiki_article', 'wiki-b', 'body', 'private', 0)`).run(SECOND_MEDIA_ID);

    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    const ownedByA = {
      announcement: { kind: "owned", ownerUserId: "author-a" },
      wikiArticle: { kind: "owned", ownerUserId: "author-a" },
    } as const;
    const ownedByB = {
      announcement: { kind: "owned", ownerUserId: "author-b" },
      wikiArticle: { kind: "owned", ownerUserId: "author-b" },
    } as const;
    const all = { announcement: { kind: "all" }, wikiArticle: { kind: "all" } } as const;

    await expect(store.describeRead(MEDIA_ID, "view", NOW, ownedByA))
      .resolves.toMatchObject({ contentReadable: false });
    await expect(store.describeRead(SECOND_MEDIA_ID, "view", NOW, ownedByA))
      .resolves.toMatchObject({ contentReadable: false });
    await expect(store.describeRead(MEDIA_ID, "view", NOW, ownedByB))
      .resolves.toMatchObject({ contentReadable: true });
    await expect(store.describeRead(SECOND_MEDIA_ID, "view", NOW, ownedByB))
      .resolves.toMatchObject({ contentReadable: true });
    await expect(store.describeRead(MEDIA_ID, "view", NOW, all))
      .resolves.toMatchObject({ contentReadable: true });
    await expect(store.describeRead(SECOND_MEDIA_ID, "view", NOW, all))
      .resolves.toMatchObject({ contentReadable: true });
  });

  it("does not expose scheduled or expired announcement media through a direct public URL", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES ('author-a', 'Author A', 'member', 'author-a-revision-0001')`).run();
    database.prepare(`INSERT INTO announcements (
      id, title, body_json, pinned, status, publish_at, expires_at,
      created_by, revision_token, created_at, updated_at
    ) VALUES (
      'announcement-scheduled', 'Scheduled', '{"type":"doc","content":[]}', 0, 'published',
      '2026-08-09T13:00:00.000Z', '2026-08-09T14:00:00.000Z',
      'author-a', 'announcement-scheduled-revision', ?, ?
    )`).run(NOW, NOW);
    database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'author-a', 'announcement_image', 'image', 'attached', NULL, ?, ?)`).run(MEDIA_ID, NOW, NOW);
    database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`)
      .run(MEDIA_ID, `media/${MEDIA_ID}/view.webp`, "e".repeat(64));
    database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, 'announcement', 'announcement-scheduled', 'body', 'public', 0)`).run(MEDIA_ID);

    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    const owned = {
      announcement: { kind: "owned", ownerUserId: "author-a" },
      wikiArticle: PUBLIC_SCOPE,
    } as const;

    await expect(store.describeRead(MEDIA_ID, "view", NOW, PUBLIC_CONTENT_SCOPES)).resolves.toMatchObject({
      audience: "private",
      contentReadable: false,
    });
    await expect(store.describeRead(MEDIA_ID, "view", NOW, owned)).resolves.toMatchObject({
      audience: "private",
      contentReadable: true,
    });
    await expect(store.describeRead(
      MEDIA_ID,
      "view",
      "2026-08-09T13:30:00.000Z",
      PUBLIC_CONTENT_SCOPES,
    )).resolves.toMatchObject({ audience: "public" });
    await expect(store.describeRead(
      MEDIA_ID,
      "view",
      "2026-08-09T14:00:00.000Z",
      PUBLIC_CONTENT_SCOPES,
    )).resolves.toMatchObject({
      audience: "private",
      contentReadable: false,
    });
  });

  it("derives public event and member media from the current parent visibility", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES ('member-1', 'Member', 'member', 'member-revision-0001')`).run();
    database.prepare(`INSERT INTO member_profiles (user_id, power, revision_token, created_at, updated_at)
      VALUES ('member-1', 0, 'member-profile-revision-0001', ?, ?)`).run(NOW, NOW);
    database.prepare(`INSERT INTO events (id, type, title, start_at, visible_at, created_by)
      VALUES ('event-1', 'other', 'Scheduled event', ?, '2026-08-09T13:00:00.000Z', 'member-1')`).run(NOW);

    const eventMediaId = mediaId(1);
    const avatarMediaId = mediaId(2);
    const imageMediaId = mediaId(3);
    const audioMediaId = mediaId(4);
    const insertImage = database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'member-1', ?, 'image', 'attached', NULL, ?, ?)`);
    const insertImageVariant = database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`);
    const insertAudio = database.prepare(`INSERT INTO media_assets (
      id, owner_user_id, purpose, media_type, original_name, state, expires_at, created_at, updated_at
    ) VALUES (?, 'member-1', 'member_audio', 'audio', 'profile.ogg', 'attached', NULL, ?, ?)`);
    const insertAudioVariant = database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'audio/ogg', 10, ?, NULL, NULL)`);
    const insertLink = database.prepare(`INSERT INTO media_links
      (media_id, entity_type, entity_id, slot, audience, sort_order)
      VALUES (?, ?, ?, ?, 'public', 0)`);

    insertImage.run(eventMediaId, "event_image", NOW, NOW);
    insertImageVariant.run(eventMediaId, `media/${eventMediaId}/view.webp`, "a".repeat(64));
    insertLink.run(eventMediaId, "event", "event-1", "attachment");
    insertImage.run(avatarMediaId, "member_avatar", NOW, NOW);
    insertImageVariant.run(avatarMediaId, `media/${avatarMediaId}/view.webp`, "b".repeat(64));
    insertLink.run(avatarMediaId, "member_profile", "member-1", "avatar");
    insertImage.run(imageMediaId, "member_image", NOW, NOW);
    insertImageVariant.run(imageMediaId, `media/${imageMediaId}/view.webp`, "c".repeat(64));
    insertLink.run(imageMediaId, "member_profile", "member-1", "image");
    insertAudio.run(audioMediaId, NOW, NOW);
    insertAudioVariant.run(audioMediaId, `media/${audioMediaId}/view.ogg`, "d".repeat(64));
    insertLink.run(audioMediaId, "member_profile", "member-1", "audio");

    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    const publicRead = (id: string) => store.describeRead(id, "view", NOW, PUBLIC_CONTENT_SCOPES);

    await expect(publicRead(eventMediaId)).resolves.toMatchObject({ audience: "private" });
    database.prepare("UPDATE events SET visible_at = ? WHERE id = 'event-1'").run("2026-08-09T11:00:00.000Z");
    await expect(publicRead(eventMediaId)).resolves.toMatchObject({ audience: "public" });
    database.prepare("UPDATE events SET archived_at = ? WHERE id = 'event-1'").run(NOW);
    await expect(publicRead(eventMediaId)).resolves.toMatchObject({ audience: "private" });

    for (const id of [avatarMediaId, imageMediaId, audioMediaId]) {
      await expect(publicRead(id)).resolves.toMatchObject({ audience: "public" });
    }
    database.prepare("UPDATE users SET is_active = 0 WHERE id = 'member-1'").run();
    for (const id of [avatarMediaId, imageMediaId, audioMediaId]) {
      await expect(publicRead(id)).resolves.toMatchObject({ audience: "private" });
    }
    database.prepare("UPDATE users SET is_active = 1, deleted_at = ? WHERE id = 'member-1'").run(NOW);
    for (const id of [avatarMediaId, imageMediaId, audioMediaId]) {
      await expect(publicRead(id)).resolves.toMatchObject({ audience: "private" });
    }
  });

  it("reserves multiple uploads in one transaction and stages them with one mutation", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
    const executor = new SqliteTestExecutor(database);
    const store = new SqliteMediaStore(executor);
    const reservations = [reservation(MEDIA_ID), reservation(SECOND_MEDIA_ID)];

    await store.reserveUploads(reservations, "request-untracked");
    expect(executor.batches).toHaveLength(1);
    expect(executor.batches[0]).toHaveLength(3);
    const beforeStage = executor.statements.length;
    await store.markStaged([MEDIA_ID, SECOND_MEDIA_ID], NOW);

    expect(executor.statements).toHaveLength(beforeStage + 1);
    expect(database.prepare("SELECT state FROM media_assets ORDER BY id").all())
      .toEqual([{ state: "staged" }, { state: "staged" }]);
  });

  it("registers only this request's media and lets system-test cleanup remove its rows and blobs", async () => {
    const { database, executor, store } = mediaFixture();
    const requestId = "request-media-system-test";
    const owner = createRequestContext({
      requestId,
      authorization: createAuthorizationContext({
        userId: "owner-1",
        sessionId: "session-owner-1",
        roleId: "admin",
        roleLevel: 1,
        permissions: ["admin.status.view"],
      }),
      now: NOW,
    });
    const deleteBlobs = vi.fn();
    const systemTests = new SystemTestService(
      new SqliteSystemTestStore(executor),
      new SqliteSystemTestArtifactCleaner(executor),
      { delete: deleteBlobs } as unknown as BlobStore,
    );
    const { runId } = await systemTests.createRun(owner);
    await systemTests.beginRequest(owner, runId);

    await store.reserveUploads([imageReservation(MEDIA_ID)], requestId);
    await store.reserveUploads([imageReservation(SECOND_MEDIA_ID)], "request-not-under-system-test");

    expect(database.prepare(`SELECT run_id, artifact_type, artifact_key, request_id
      FROM system_test_artifacts ORDER BY artifact_key`).all()).toEqual([{
      run_id: runId,
      artifact_type: "media_asset",
      artifact_key: MEDIA_ID,
      request_id: requestId,
    }]);

    await systemTests.endRequest(requestId);
    await expect(systemTests.cleanupRun(owner, runId))
      .resolves.toEqual({ ok: true, status: "completed", attempts: 1 });
    expect(deleteBlobs).toHaveBeenCalledWith([
      `media/${MEDIA_ID}/full.webp`,
      `media/${MEDIA_ID}/view.webp`,
    ]);
    expect(database.prepare("SELECT id FROM media_assets ORDER BY id").all())
      .toEqual([{ id: SECOND_MEDIA_ID }]);
    expect(database.prepare("SELECT media_id FROM media_variants ORDER BY media_id, variant").all())
      .toEqual([{ media_id: SECOND_MEDIA_ID }, { media_id: SECOND_MEDIA_ID }]);
  });

  it("keeps the maximum upload reservation set bounded and rolls it back on a late variant failure", async () => {
    const success = mediaFixture();
    const reservations = Array.from({ length: 50 }, (_, index) => imageReservation(mediaId(index)));

    await success.store.reserveUploads(reservations, "request-untracked");
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(success.database.prepare("SELECT count(*) AS count FROM media_assets").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_variants").get()).toMatchObject({ count: 100 });

    const failed = mediaFixture();
    startSystemTestRequest(failed.database, "run-failed-media", "request-failed-media");
    const last = reservations.at(-1)!;
    const invalid = [...reservations.slice(0, -1), { ...last, variants: [last.variants[0]!, last.variants[0]!] }];

    await expect(failed.store.reserveUploads(invalid, "request-failed-media")).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_variants").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM system_test_artifacts").get())
      .toMatchObject({ count: 0 });
  });

  it.each([
    ["below", LIMITS.media.pendingPerOwner.maxAssets - 1, LIMITS.media.pendingPerOwner.maxBytes - 1],
    ["exactly at", LIMITS.media.pendingPerOwner.maxAssets, LIMITS.media.pendingPerOwner.maxBytes],
  ])("admits pending media %s the owner budget", async (_label, assetCount, byteCount) => {
    const value = mediaFixture();
    await value.store.reserveUploads(
      budgetReservations("a", "owner-1", assetCount, byteCount),
      `request-budget-${assetCount}`,
    );

    expect(value.database.prepare(`SELECT
      (SELECT count(*) FROM media_assets) AS asset_count,
      (SELECT coalesce(sum(byte_size), 0) FROM media_variants) AS byte_count`).get()).toEqual({
      asset_count: assetCount,
      byte_count: byteCount,
    });
  });

  it.each([
    ["assets", LIMITS.media.pendingPerOwner.maxAssets + 1, LIMITS.media.pendingPerOwner.maxAssets + 1],
    ["bytes", 1, LIMITS.media.pendingPerOwner.maxBytes + 1],
  ])("rejects pending media over the owner %s budget before writing rows", async (kind, assetCount, byteCount) => {
    const value = mediaFixture();
    const requestId = `request-budget-${kind}`;
    startSystemTestRequest(value.database, `run-budget-${kind}`, requestId);

    await expect(value.store.reserveUploads(
      budgetReservations("b", "owner-1", assetCount, byteCount),
      requestId,
    )).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      details: {
        max_pending_assets: LIMITS.media.pendingPerOwner.maxAssets,
        max_pending_bytes: LIMITS.media.pendingPerOwner.maxBytes,
      },
    });
    expect(value.database.prepare(`SELECT
      (SELECT count(*) FROM media_assets) AS assets,
      (SELECT count(*) FROM media_variants) AS variants,
      (SELECT count(*) FROM system_test_artifacts) AS artifacts`).get()).toEqual({
      assets: 0,
      variants: 0,
      artifacts: 0,
    });
  });

  it("isolates pending media budgets by owner", async () => {
    const value = mediaFixture();
    value.database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES ('owner-2', 'Owner 2', 'member', 'owner-revision-0002')`).run();
    await value.store.reserveUploads(
      budgetReservations(
        "c",
        "owner-1",
        LIMITS.media.pendingPerOwner.maxAssets,
        LIMITS.media.pendingPerOwner.maxBytes,
      ),
      "request-owner-1-budget",
    );

    await expect(value.store.reserveUploads(
      budgetReservations("d", "owner-2", 1, 1),
      "request-owner-2-budget",
    )).resolves.toBeUndefined();
    expect(value.database.prepare(`SELECT owner_user_id, count(*) AS asset_count
      FROM media_assets GROUP BY owner_user_id ORDER BY owner_user_id`).all()).toEqual([
      { owner_user_id: "owner-1", asset_count: LIMITS.media.pendingPerOwner.maxAssets },
      { owner_user_id: "owner-2", asset_count: 1 },
    ]);
  });

  it("serializes competing reservations at the owner budget", async () => {
    const value = mediaFixture();
    await value.store.reserveUploads(
      budgetReservations("e", "owner-1", LIMITS.media.pendingPerOwner.maxAssets - 1, 1_000),
      "request-budget-existing",
    );
    value.executor.beforeNextBatch = async () => {
      await value.store.reserveUploads(
        budgetReservations("f", "owner-1", 1, 1),
        "request-budget-winner",
      );
    };

    await expect(value.store.reserveUploads(
      budgetReservations("g", "owner-1", 1, 1),
      "request-budget-loser",
    )).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(value.database.prepare("SELECT count(*) AS count FROM media_assets").get())
      .toEqual({ count: LIMITS.media.pendingPerOwner.maxAssets });
    expect(value.database.prepare("SELECT id FROM media_assets WHERE id = ?").get(budgetMediaId("g", 0)))
      .toBeUndefined();
  });

  it("uses media-id indexes for every read-link source", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    const sql = new SqliteTestExecutor(database);
    const store = new SqliteMediaStore(sql);

    await store.describeRead(MEDIA_ID, "view", NOW, PUBLIC_CONTENT_SCOPES);
    const statement = sql.statements.at(-1);
    expect(statement).toBeDefined();
    const details = database.prepare(`EXPLAIN QUERY PLAN ${statement!.sql}`)
      .all(...[...(statement!.params ?? [])] as SQLInputValue[])
      .map((row) => String((row as Record<string, unknown>).detail));

    expect(details.some((detail) => detail.includes("SEARCH media_links USING INDEX idx_media_links_asset"))).toBe(true);
    expect(details.some((detail) => detail.includes("SEARCH revision_media USING INDEX idx_wiki_revision_media_asset"))).toBe(true);
    expect(details.some((detail) => /SCAN (media_links|revision_media)\b/.test(detail))).toBe(false);
  });

  it("commits garbage-collection deletion and its scheduler audit atomically", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    database.exec(WIKI_REVISION_MEDIA_TABLE);
    const insert = database.prepare(`INSERT INTO media_assets (
      id, purpose, media_type, state, delete_claim_token, delete_claim_until, created_at, updated_at
    ) VALUES (?, 'event_image', 'image', 'deleting', ?, ?, ?, ?)`);
    insert.run(MEDIA_ID, "claim-success", "2026-08-09T12:10:00.000Z", NOW, NOW);
    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    await store.finalizeDeletion(
      MEDIA_ID,
      "claim-success",
      createSchedulerAuditFactory("media-success", NOW)({
        subjectType: "media_cleanup",
        subjectId: MEDIA_ID,
        action: "delete",
      }),
    );
    expect(database.prepare("SELECT id FROM media_assets WHERE id = ?").get(MEDIA_ID)).toBeUndefined();
    expect(database.prepare("SELECT actor_id FROM audit_log WHERE subject_id = ?").get(MEDIA_ID))
      .toMatchObject({ actor_id: "system:scheduler" });

    const failedId = SECOND_MEDIA_ID;
    insert.run(failedId, "claim-failure", "2026-08-09T12:10:00.000Z", NOW, NOW);
    database.exec(`CREATE TRIGGER reject_media_cleanup_audit
      BEFORE INSERT ON audit_log WHEN NEW.subject_id = '${failedId}'
      BEGIN SELECT RAISE(ABORT, 'media audit rejected'); END;`);
    await expect(store.finalizeDeletion(
      failedId,
      "claim-failure",
      createSchedulerAuditFactory("media-failure", NOW)({
        subjectType: "media_cleanup",
        subjectId: failedId,
        action: "delete",
      }),
    )).rejects.toThrow("media audit rejected");
    expect(database.prepare("SELECT id FROM media_assets WHERE id = ?").get(failedId))
      .toMatchObject({ id: failedId });
  });

  it("claims a bounded garbage-collection batch with one shared claim token", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec("PRAGMA foreign_keys = ON");
    applyAppMigrations(database);
    const expiresAt = "2026-08-09T11:00:00.000Z";
    const insertAsset = database.prepare(`INSERT INTO media_assets (
      id, purpose, media_type, state, expires_at, created_at, updated_at
    ) VALUES (?, 'event_image', 'image', 'staged', ?, ?, ?)`);
    const insertVariant = database.prepare(`INSERT INTO media_variants (
      media_id, variant, object_key, content_type, byte_size, sha256, width, height
    ) VALUES (?, 'view', ?, 'image/webp', 10, ?, 1, 1)`);
    for (const mediaId of [MEDIA_ID, SECOND_MEDIA_ID]) {
      insertAsset.run(mediaId, expiresAt, expiresAt, expiresAt);
      insertVariant.run(mediaId, `media/${mediaId}/view.webp`, "b".repeat(64));
    }

    const store = new SqliteMediaStore(new SqliteTestExecutor(database));
    await expect(store.inspectGarbageBacklog(NOW)).resolves.toEqual({
      status: "known",
      pendingCount: 2,
      countPrecision: "exact",
      oldestPendingAt: expiresAt,
    });
    const claims = await store.claimGarbage(NOW, 2);

    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.mediaId)).toEqual([MEDIA_ID, SECOND_MEDIA_ID]);
    expect(new Set(claims.map((claim) => claim.claimToken))).toHaveLength(1);
    expect(claims.every((claim) => claim.objectKeys.length === 1)).toBe(true);
  });
});

function reservation(id: string): MediaReservation {
  return {
    id,
    ownerUserId: "owner-1",
    purpose: "event_image",
    mediaType: "image",
    originalName: null,
    expiresAt: "2026-08-10T12:00:00.000Z",
    createdAt: NOW,
    variants: [{
      variant: "view",
      objectKey: `media/${id}/view.webp`,
      contentType: "image/webp",
      byteSize: 10,
      sha256: "c".repeat(64),
      width: 1,
      height: 1,
    }],
  };
}

function mediaFixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
    VALUES ('owner-1', 'Owner', 'member', 'owner-revision-0001')`).run();
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteMediaStore(executor) };
}

function startSystemTestRequest(database: DatabaseSync, runId: string, requestId: string): void {
  database.prepare(`INSERT INTO system_test_runs
    (id, actor_user_id, status, cleanup_attempts, expires_at, created_at, updated_at)
    VALUES (?, 'owner-1', 'running', 0, '2026-08-10T12:00:00.000Z', ?, ?)`).run(runId, NOW, NOW);
  database.prepare(`INSERT INTO system_test_requests (request_id, run_id, actor_user_id, started_at)
    VALUES (?, ?, 'owner-1', ?)`).run(requestId, runId, NOW);
}

function mediaId(index: number): string {
  return `m${String(index).padStart(20, "0")}`;
}

function imageReservation(id: string): MediaReservation {
  return {
    ...reservation(id),
    variants: (["full", "view"] as const).map((variant) => ({
      variant,
      objectKey: `media/${id}/${variant}.webp`,
      contentType: "image/webp" as const,
      byteSize: 10,
      sha256: "d".repeat(64),
      width: 1,
      height: 1,
    })),
  };
}

function budgetReservations(
  idPrefix: string,
  ownerUserId: string,
  assetCount: number,
  byteCount: number,
): readonly MediaReservation[] {
  if (assetCount < 1 || byteCount < assetCount) throw new RangeError("Budget fixture requires at least one byte per asset");
  return Array.from({ length: assetCount }, (_, index) => {
    const id = budgetMediaId(idPrefix, index);
    const base = reservation(id);
    return {
      ...base,
      ownerUserId,
      variants: [{
        ...base.variants[0]!,
        byteSize: index === assetCount - 1 ? byteCount - assetCount + 1 : 1,
      }],
    };
  });
}

function budgetMediaId(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(20, "0")}`;
}
