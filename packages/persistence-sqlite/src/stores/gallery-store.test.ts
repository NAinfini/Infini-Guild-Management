import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SQL_BATCH_STATEMENTS, createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import type { GalleryRecord } from "@guild/server/modules/gallery";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteGalleryStore } from "./gallery-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "owner-1";
const MEDIA_IDS = ["ddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeee"] as const;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
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
      id, type, url, caption, uploaded_by, revision_token, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insert.run("gallery-blank", "video", "https://example.com/video", "   ", OWNER, "revision-gallery-blank-0001", NOW);
    insert.run("gallery-named", "video", "https://example.com/video", "Named video", OWNER, "revision-gallery-named-0001", NOW);
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

function record(id: string, mediaId: string): GalleryRecord {
  return {
    id,
    type: "image",
    media_id: mediaId,
    url: null,
    caption: null,
    uploaded_by: OWNER,
    uploaded_by_name: null,
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

function requestContext() {
  return createRequestContext({
    requestId: crypto.randomUUID(),
    authorization: createAuthorizationContext({
      userId: OWNER,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions: [],
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
