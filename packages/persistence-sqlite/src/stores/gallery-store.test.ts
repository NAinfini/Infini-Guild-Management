import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SQL_BATCH_STATEMENTS, createAuthorizationContext, createRequestContext, type BlobStore } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import { GalleryService, type GalleryRecord } from "@guild/server/modules/gallery";
import { MediaService } from "@guild/server/modules/media";
import { SystemTestService } from "@guild/server/modules/system-test";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAuditStore } from "./audit-store.js";
import { SqliteGalleryStore } from "./gallery-store.js";
import { SqliteMediaStore } from "./media-store.js";
import { SqliteSystemTestArtifactCleaner } from "./system-test-artifact-cleaner.js";
import { SqliteSystemTestStore } from "./system-test-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "owner-1";
const MEDIA_IDS = ["ddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeee"] as const;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("gallery upload system-test cleanup", () => {
  it.each([1, 50])("registers and cleans %i uploaded images without touching ordinary content or another run", async (count) => {
    const { database, executor, store } = fixture();
    const objects = new Set<string>();
    const blobs = {
      putIfAbsent: vi.fn<BlobStore["putIfAbsent"]>(async (key, input) => {
        await new Response(input.body).arrayBuffer();
        objects.add(key);
        return { key, size: input.size, contentType: input.contentType, sha256: input.sha256, etag: input.sha256, lastModified: NOW };
      }),
      delete: vi.fn<BlobStore["delete"]>(async (keys) => {
        for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
      }),
    } as unknown as BlobStore;
    const gallery = new GalleryService(store, new MediaService(new SqliteMediaStore(executor), blobs),
      { publish: vi.fn() }, { defer: vi.fn() });
    const runStore = new SqliteSystemTestStore(executor);
    const runs = new SystemTestService(runStore, new SqliteSystemTestArtifactCleaner(executor), blobs);
    const owner = requestContext(["gallery.upload", "admin.status.view"]);
    const image = Uint8Array.from(atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), (value) => value.charCodeAt(0));
    const upload = (context: ReturnType<typeof requestContext>, size: number) => gallery.uploadImages(
      context,
      Array.from({ length: size }, () => ({ full: image, view: image })),
      Array.from({ length: size }, (_, index) => ({ title: `Gallery image ${index}`, description: null })),
      10_000,
      100,
    );
    const ordinary = (await upload(owner, 1)).data[0]!;
    const other = requestContext(["gallery.upload", "admin.status.view"]);
    const otherRun = await runs.createRun(other);
    await runs.beginRequest(other, otherRun.runId);
    const otherImage = (await upload(other, 1)).data[0]!;
    await runs.endRequest(other.requestId);
    const { runId } = await runs.createRun(owner);
    await runs.beginRequest(owner, runId);
    const { data } = await upload(owner, count);
    await runs.endRequest(owner.requestId);

    const registered = await runStore.listArtifacts(runId, 200);
    expect(registered.filter(({ type }) => type === "gallery_item").map(({ key }) => key).sort())
      .toEqual(data.map(({ id }) => id).sort());
    expect(registered.filter(({ type }) => type === "media_asset").map(({ key }) => key).sort())
      .toEqual(data.map(({ media_id }) => media_id).sort());
    const subjectId = data.map(({ id }) => id).join(",");
    const audit = await new SqliteAuditStore(executor).list({
      cursor: null, limit: 100, subjectType: "gallery_item", subjectId,
    });
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0]).toMatchObject({ request_id: owner.requestId, subject: { id: subjectId }, action: "upload_images" });

    let cleanup = await runs.cleanupRun(owner, runId);
    for (let remaining = registered.length; !cleanup.ok && remaining > 0; remaining -= 1) {
      expect(cleanup.status).toBe("cleaning");
      cleanup = await runs.cleanupRun(owner, runId);
    }
    expect(cleanup).toMatchObject({ ok: true, status: "completed" });
    await runs.finalizeRun(owner, runId);
    expect(await runStore.getRun(runId)).toBeNull();
    expect((await runStore.getRun(otherRun.runId))?.status).toBe("running");
    for (const item of data) expect(await store.get(item.id, OWNER)).toBeNull();
    for (const item of [ordinary, otherImage]) expect(await store.get(item.id, OWNER)).toMatchObject({ id: item.id });
    const retainedMedia = [ordinary.media_id, otherImage.media_id].sort();
    expect(database.prepare("SELECT id FROM media_assets ORDER BY id").all().map((row) => row.id)).toEqual(retainedMedia);
    expect(database.prepare("SELECT media_id FROM media_links ORDER BY media_id").all().map((row) => row.media_id)).toEqual(retainedMedia);
    expect([...objects].sort()).toEqual(retainedMedia.flatMap((id) => [`media/${id}/full.webp`, `media/${id}/view.webp`]).sort());
  });
});

describe("SqliteGalleryStore quota claims", () => {
  it("admits only one competing image batch and leaves the losing blob staged for GC", async () => {
    const { database, store } = fixture();
    for (const mediaId of MEDIA_IDS) insertMedia(database, mediaId);

    const results = await Promise.allSettled(MEDIA_IDS.map((mediaId, index) => store.createImages({
      records: [record(`gallery-${index + 1}`, mediaId)],
      mediaIds: [mediaId],
      ownerUserId: OWNER,
      maxItems: 1,
      audit: audit(`gallery-${index + 1}`),
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "VALIDATION_ERROR", status: 400 },
    });
    expect(number(database, "SELECT COUNT(*) FROM gallery_items WHERE uploaded_by = ? AND type = 'image'", OWNER)).toBe(1);
    const linked = text(database, "SELECT media_id FROM media_links WHERE entity_type = 'gallery_item'");
    const loser = MEDIA_IDS.find((mediaId) => mediaId !== linked)!;
    expect(text(database, "SELECT state FROM media_assets WHERE id = ?", loser)).toBe("staged");
  });

  it("uses the owner/type covering index for quota claims", () => {
    const { database } = fixture();
    database.exec(`DROP INDEX idx_gallery_items_owner_created;
      CREATE INDEX idx_gallery_items_owner_created
      ON gallery_items(uploaded_by, type, created_at, id);`);
    const plan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT COUNT(*) FROM gallery_items WHERE uploaded_by = ? AND type = 'image'`)
      .all(OWNER) as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join("\n")).toContain("COVERING INDEX idx_gallery_items_owner_created");
  });

  it("keeps a maximum image set bounded and rolls every parent and link back when audit insertion fails", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => galleryMediaId(index));
    const records = ids.map((mediaId, index) => record(`gallery-max-${String(index).padStart(2, "0")}`, mediaId));

    const success = fixture();
    ids.forEach((id) => insertMedia(success.database, id));
    await success.store.createImages({
      records,
      mediaIds: ids,
      ownerUserId: OWNER,
      maxItems: 50,
      audit: audit("gallery-max"),
    });
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(success.database.prepare("SELECT count(*) AS count FROM gallery_items").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 50 });
    expect(success.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'attached'").get())
      .toMatchObject({ count: 50 });

    const failed = fixture();
    ids.forEach((id) => insertMedia(failed.database, id));
    const rejectedAudit = audit("gallery-max-failed");
    failed.database.prepare(`INSERT INTO audit_log (
      id, request_id, actor_kind, actor_id, actor_label, subject_type, subject_id,
      subject_label, action, payload_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      rejectedAudit.eventId,
      rejectedAudit.requestId,
      rejectedAudit.actorKind,
      rejectedAudit.actorId,
      rejectedAudit.actorLabel,
      rejectedAudit.subjectType,
      rejectedAudit.subjectId,
      rejectedAudit.subjectLabel,
      rejectedAudit.action,
      JSON.stringify(rejectedAudit.payload),
      rejectedAudit.occurredAt,
    );
    await expect(failed.store.createImages({
      records,
      mediaIds: ids,
      ownerUserId: OWNER,
      maxItems: 50,
      audit: rejectedAudit,
    })).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM gallery_items").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'staged'").get())
      .toMatchObject({ count: 50 });
  });

  it("audits only the gallery rows actually deleted with readable labels", async () => {
    const value = fixture();
    const insert = value.database.prepare(`INSERT INTO gallery_items (
      id, type, url, caption, uploaded_by, revision_token, created_at, title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("gallery-blank", "video", "https://example.com/video", "   ", OWNER, "revision-gallery-blank-0001", NOW, "video");
    insert.run("gallery-named", "video", "https://example.com/video", "Named video", OWNER, "revision-gallery-named-0001", NOW, "Named video");
    const mutation = createAuditEvent(requestContext(), {
      subjectType: "gallery_item",
      subjectId: "request-batch",
      subjectLabel: "Gallery items",
      action: "batch_delete",
    });

    await expect(value.store.batchDelete({
      ids: ["gallery-named", "gallery-missing", "gallery-blank"],
      mutationToken: "gallery-batch-delete-token",
      audit: mutation,
    })).resolves.toBe(2);

    const row = value.database.prepare(
      "SELECT actor_label, payload_json FROM audit_log WHERE id = ?",
    ).get(mutation.eventId) as { actor_label: string; payload_json: string };
    expect(row.actor_label).toBe("Owner");
    expect(JSON.parse(row.payload_json)).toEqual({
      schema_version: 2,
      changes: [],
      context: [
        { field: "item_count", value: { type: "number", value: 2 } },
        { field: "item_ids", value: { type: "list", value: [
          { type: "reference", value: { id: "gallery-blank", label: "video" } },
          { type: "reference", value: { id: "gallery-named", label: "Named video" } },
        ] } },
      ],
    });
  });

  it("returns not found without an audit or foreign-key failure when the item is deleted before a like commits", async () => {
    const { database, executor, store } = fixture();
    insertGalleryItem(database, "gallery-like-race");
    const auditEvent = audit("gallery-like-race");
    executor.beforeNextBatch = () => {
      database.prepare("DELETE FROM gallery_items WHERE id = ?").run("gallery-like-race");
    };

    await expect(store.setLike({
      id: "gallery-like-race",
      userId: OWNER,
      liked: true,
      audit: auditEvent,
    })).resolves.toEqual({ outcome: "not_found" });

    expect(number(database, "SELECT COUNT(*) FROM gallery_likes WHERE item_id = ?", "gallery-like-race")).toBe(0);
    expect(number(database, "SELECT COUNT(*) FROM audit_log WHERE id = ?", auditEvent.eventId)).toBe(0);
  });

  it("updates metadata and writes its audit atomically behind the item revision", async () => {
    const { database, store } = fixture();
    insertGalleryItem(database, "gallery-update");
    const updateAudit = createAuditEvent(requestContext(), {
      subjectType: "gallery_item",
      subjectId: "gallery-update",
      subjectLabel: "Renamed",
      action: "update",
      changes: [{
        field: "title",
        before: { type: "text", value: "Race" },
        after: { type: "text", value: "Renamed" },
      }],
    });

    await expect(store.updateMetadata({
      id: "gallery-update",
      expectedRevisionToken: "gallery-like-race-revision-0001",
      newRevisionToken: "gallery-update-revision-0002",
      title: "Renamed",
      description: "Updated description",
      audit: updateAudit,
    })).resolves.toBe(true);

    expect(database.prepare(
      "SELECT title, caption, revision_token FROM gallery_items WHERE id = ?",
    ).get("gallery-update")).toEqual({
      title: "Renamed",
      caption: "Updated description",
      revision_token: "gallery-update-revision-0002",
    });
    expect(number(database, "SELECT COUNT(*) FROM audit_log WHERE id = ?", updateAudit.eventId)).toBe(1);

    const staleAudit = createAuditEvent(requestContext(), {
      subjectType: "gallery_item",
      subjectId: "gallery-update",
      action: "update",
    });
    await expect(store.updateMetadata({
      id: "gallery-update",
      expectedRevisionToken: "gallery-like-race-revision-0001",
      newRevisionToken: "gallery-update-revision-stale",
      title: "Stale",
      description: null,
      audit: staleAudit,
    })).resolves.toBe(false);
    expect(number(database, "SELECT COUNT(*) FROM audit_log WHERE id = ?", staleAudit.eventId)).toBe(0);
  });

  it("keeps successful like and unlike writes paired with their audit records", async () => {
    const { database, store } = fixture();
    insertGalleryItem(database, "gallery-like-atomic");
    const likedAudit = audit("gallery-like-atomic-liked");
    const unlikedAudit = audit("gallery-like-atomic-unliked");

    await expect(store.setLike({
      id: "gallery-like-atomic",
      userId: OWNER,
      liked: true,
      audit: likedAudit,
    })).resolves.toEqual({ outcome: "ok", changed: true, likeCount: 1 });
    expect(number(database, "SELECT COUNT(*) FROM gallery_likes WHERE item_id = ?", "gallery-like-atomic")).toBe(1);
    expect(number(database, "SELECT COUNT(*) FROM audit_log WHERE id = ?", likedAudit.eventId)).toBe(1);

    await expect(store.setLike({
      id: "gallery-like-atomic",
      userId: OWNER,
      liked: false,
      audit: unlikedAudit,
    })).resolves.toEqual({ outcome: "ok", changed: true, likeCount: 0 });
    expect(number(database, "SELECT COUNT(*) FROM gallery_likes WHERE item_id = ?", "gallery-like-atomic")).toBe(0);
    expect(number(database, "SELECT COUNT(*) FROM audit_log WHERE id = ?", unlikedAudit.eventId)).toBe(1);
  });
});

function fixture(): { database: DatabaseSync; executor: SqliteTestExecutor; store: SqliteGalleryStore } {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
    VALUES (?, 'Owner', 'member', 'owner-revision-0001')`).run(OWNER);
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteGalleryStore(executor) };
}

function insertMedia(database: DatabaseSync, mediaId: string): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
  ) VALUES (?, ?, 'gallery_image', 'image', 'staged', '2026-08-10T12:00:00.000Z', ?, ?)`)
    .run(mediaId, OWNER, NOW, NOW);
}

function insertGalleryItem(database: DatabaseSync, id: string): void {
  database.prepare(`INSERT INTO gallery_items (
    id, type, url, caption, uploaded_by, revision_token, created_at, title
  ) VALUES (?, 'video', 'https://example.com/video', NULL, ?, 'gallery-like-race-revision-0001', ?, 'Race')`)
    .run(id, OWNER, NOW);
}

function record(id: string, mediaId: string): GalleryRecord {
  return {
    id,
    type: "image",
    media_id: mediaId,
    url: null,
    title: "Gallery image",
    description: null,
    uploaded_by: OWNER,
    uploaded_by_name: null,
    like_count: 0,
    liked_by_viewer: false,
    created_at: NOW,
    revisionToken: `revision-${id}-0001`,
  };
}

function galleryMediaId(index: number): string {
  return `g${String(index).padStart(20, "0")}`;
}

function audit(entityId: string) {
  return createAuditEvent(requestContext(), {
    subjectType: "gallery_item",
    subjectId: entityId,
    action: "upload_images",
  });
}

function requestContext(permissions: readonly string[] = []) {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext({
      userId: OWNER,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    }),
    now: NOW,
  });
}

function text(database: DatabaseSync, sql: string, value?: string): string {
  const row = database.prepare(sql).get(...(value === undefined ? [] : [value])) as Record<string, unknown> | undefined;
  const result = row ? Object.values(row)[0] : undefined;
  if (typeof result !== "string") throw new TypeError("Expected text result");
  return result;
}

function number(database: DatabaseSync, sql: string, value: string): number {
  const row = database.prepare(sql).get(value) as Record<string, unknown> | undefined;
  const result = row ? Object.values(row)[0] : undefined;
  if (typeof result !== "number") throw new TypeError("Expected numeric result");
  return result;
}
