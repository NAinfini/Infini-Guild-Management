import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SQL_BATCH_STATEMENTS, createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import type { AnnouncementRecord } from "@guild/server/modules/announcements";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAnnouncementStore } from "./announcement-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "owner-1";
const ANNOUNCEMENT = "announcement-1";
const MEDIA_IDS = ["aaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbb", "ccccccccccccccccccccc"] as const;
const ATTACHMENT_IDS = ["ddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeee"] as const;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteAnnouncementStore", () => {
  it("returns a body-free list summary while detail retains the full rich body", async () => {
    const { database, store } = fixture();
    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20_000) }] }] });
    insertAnnouncement(database, body);

    const page = await store.list({ page: 1, limit: 20, sort: "updated_desc", canReadAll: false, now: NOW });
    expect(page.data[0]).not.toHaveProperty("body_json");
    expect(page.data[0]?.author).toEqual({ id: OWNER, display_name: "Owner", avatar_media_id: null });
    expect((await store.get(ANNOUNCEMENT, false, NOW))?.body_json).toBe(body);
  });

  it("claims append quota atomically across competing stale revisions and leaves losers staged", async () => {
    const { database, store } = fixture();
    insertAnnouncement(database, '{"type":"doc","content":[]}');
    for (const mediaId of MEDIA_IDS) insertMedia(database, mediaId);

    const writes = await Promise.all([
      store.appendImages(appendInput(MEDIA_IDS[0], "revision-winner-a-0001")),
      store.appendImages(appendInput(MEDIA_IDS[1], "revision-winner-b-0001")),
    ]);
    expect(writes.sort()).toEqual([false, true]);
    expect(number(database, "SELECT COUNT(*) FROM media_links WHERE entity_type = 'announcement' AND entity_id = ?", ANNOUNCEMENT)).toBe(1);

    const linked = text(database, "SELECT media_id FROM media_links WHERE entity_type = 'announcement' AND entity_id = ?", ANNOUNCEMENT);
    const loser = MEDIA_IDS.find((mediaId) => mediaId !== linked)!;
    expect(text(database, "SELECT state FROM media_assets WHERE id = ?", loser)).toBe("staged");

    const revision = text(database, "SELECT revision_token FROM announcements WHERE id = ?", ANNOUNCEMENT);
    await expect(store.appendImages({
      ...appendInput(MEDIA_IDS[2], "revision-over-quota-0001"),
      expectedRevisionToken: revision,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(text(database, "SELECT state FROM media_assets WHERE id = ?", MEDIA_IDS[2])).toBe("staged");
  });

  it("orders managed attachments and omits private attachment metadata from public detail", async () => {
    const { database, store } = fixture();
    insertAnnouncement(database, '{"type":"doc","content":[]}');
    insertAttachment(database, ATTACHMENT_IDS[0], "public-guide.pdf", "public", 1);
    insertAttachment(database, ATTACHMENT_IDS[1], "private-plan.xlsx", "private", 0);

    const publicDetail = await store.get(ANNOUNCEMENT, false, NOW);
    const managedDetail = await store.get(ANNOUNCEMENT, true, NOW);

    expect(publicDetail?.attachments).toEqual([expect.objectContaining({ media_id: ATTACHMENT_IDS[0] })]);
    expect(managedDetail?.attachments.map(({ media_id }) => media_id)).toEqual([ATTACHMENT_IDS[1], ATTACHMENT_IDS[0]]);
  });

  it("uses the public-list index without a temporary order B-tree", () => {
    const { database } = fixture();
    database.exec(`DROP INDEX idx_announcements_public;
      CREATE INDEX idx_announcements_public
      ON announcements(status, pinned, updated_at, id, publish_at, expires_at);`);
    const plan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT announcements.id, announcements.title, announcements.pinned, announcements.status,
        announcements.publish_at, announcements.expires_at, announcements.archived_at,
        announcements.created_by, announcements.updated_by, announcements.created_at, announcements.updated_at,
        authors.id, authors.display_name
      FROM announcements INDEXED BY idx_announcements_public
      JOIN users AS authors ON authors.id = announcements.created_by
      WHERE announcements.status = 'published' AND announcements.publish_at <= ?
        AND (announcements.expires_at IS NULL OR announcements.expires_at > ?)
      ORDER BY announcements.pinned DESC, announcements.updated_at DESC, announcements.id DESC
      LIMIT ? OFFSET ?`).all(NOW, NOW, 20, 0) as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_announcements_public");
    expect(detail).not.toContain("USE TEMP B-TREE");
  });

  it("keeps the 100-image policy maximum bounded and rolls parent, links, and lifecycle state back together", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => announcementMediaId(index));
    const record = announcementRecord();

    const success = fixture();
    ids.forEach((id) => insertMedia(success.database, id));
    await success.store.create({
      record,
      mediaIds: ids,
      attachmentMediaIds: [],
      maxItems: 100,
      maxAttachmentItems: 5,
      audit: announcementAudit("announcement-max-success"),
    });
    expect(success.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    const linked = success.database.prepare(`SELECT media_id FROM media_links
      WHERE entity_type = 'announcement' AND entity_id = ? ORDER BY sort_order`).all(ANNOUNCEMENT) as Array<{ media_id: string }>;
    expect(linked.map(({ media_id }) => media_id)).toEqual(ids);
    expect(success.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'attached'").get())
      .toMatchObject({ count: 100 });

    const failed = fixture();
    ids.forEach((id) => insertMedia(failed.database, id));
    const rejectedAudit = announcementAudit("announcement-max-failed");
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
    await expect(failed.store.create({
      record,
      mediaIds: ids,
      attachmentMediaIds: [],
      maxItems: 100,
      maxAttachmentItems: 5,
      audit: rejectedAudit,
    })).rejects.toThrow(/UNIQUE/i);
    expect(failed.executor.batches.at(-1)?.length).toBeLessThanOrEqual(MAX_SQL_BATCH_STATEMENTS);
    expect(failed.database.prepare("SELECT count(*) AS count FROM announcements").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_links").get()).toMatchObject({ count: 0 });
    expect(failed.database.prepare("SELECT count(*) AS count FROM media_assets WHERE state = 'staged'").get())
      .toMatchObject({ count: 100 });
  });
});

function fixture(): { database: DatabaseSync; executor: SqliteTestExecutor; store: SqliteAnnouncementStore } {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
    VALUES (?, 'Owner', 'member', 'owner-revision-0001')`).run(OWNER);
  const executor = new SqliteTestExecutor(database);
  return { database, executor, store: new SqliteAnnouncementStore(executor) };
}

function insertAnnouncement(database: DatabaseSync, bodyJson: string): void {
  database.prepare(`INSERT INTO announcements (
    id, title, body_json, pinned, status, publish_at, created_by, revision_token, created_at, updated_at
  ) VALUES (?, 'Notice', ?, 0, 'published', ?, ?, 'revision-original-0001', ?, ?)`)
    .run(ANNOUNCEMENT, bodyJson, NOW, OWNER, NOW, NOW);
}

function insertMedia(database: DatabaseSync, mediaId: string): void {
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, expires_at, created_at, updated_at
  ) VALUES (?, ?, 'announcement_image', 'image', 'staged', '2026-08-10T12:00:00.000Z', ?, ?)`)
    .run(mediaId, OWNER, NOW, NOW);
}

function insertAttachment(
  database: DatabaseSync,
  mediaId: string,
  originalName: string,
  audience: "public" | "private",
  sortOrder: number,
): void {
  const contentType = originalName.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  database.prepare(`INSERT INTO media_assets (
    id, owner_user_id, purpose, media_type, state, original_name, expires_at, created_at, updated_at
  ) VALUES (?, ?, 'announcement_attachment', 'file', 'staged', ?, '2026-08-10T12:00:00.000Z', ?, ?)`)
    .run(mediaId, OWNER, originalName, NOW, NOW);
  database.prepare(`INSERT INTO media_variants (
    media_id, variant, object_key, content_type, byte_size, sha256, width, height
  ) VALUES (?, 'full', ?, ?, 128, ?, NULL, NULL)`)
    .run(mediaId, `media/${mediaId}/full`, contentType, "a".repeat(64));
  database.prepare(`INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
    VALUES (?, 'announcement', ?, 'attachment', ?, ?)`)
    .run(mediaId, ANNOUNCEMENT, audience, sortOrder);
}

function announcementMediaId(index: number): string {
  return `a${String(index).padStart(20, "0")}`;
}

function announcementRecord(): AnnouncementRecord {
  return {
    id: ANNOUNCEMENT,
    title: "Maximum media notice",
    body_json: '{"type":"doc","content":[]}',
    pinned: false,
    status: "draft",
    publish_at: null,
    expires_at: null,
    archived_at: null,
    created_by: OWNER,
    updated_by: OWNER,
    created_at: NOW,
    updated_at: NOW,
    revisionToken: "announcement-max-revision-0001",
  };
}

function announcementAudit(requestId: string) {
  return createAuditEvent({ ...requestContext(), requestId }, {
    subjectType: "announcement",
    subjectId: ANNOUNCEMENT,
    action: "create",
  });
}

function appendInput(mediaId: string, revisionToken: string) {
  return {
    id: ANNOUNCEMENT,
    expectedRevisionToken: "revision-original-0001",
    revisionToken,
    updatedAt: "2026-08-09T12:00:01.000Z",
    ownerUserId: OWNER,
    purpose: "announcement_image" as const,
    mediaIds: [mediaId],
    audience: "public" as const,
    maxItems: 1,
    audit: createAuditEvent(requestContext(), {
      subjectType: "announcement",
      subjectId: ANNOUNCEMENT,
      action: "upload_images",
    }),
  };
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

function text(database: DatabaseSync, sql: string, value: string): string {
  const row = database.prepare(sql).get(value) as Record<string, unknown> | undefined;
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
