import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SQL_BATCH_STATEMENTS,
  createAuthorizationContext,
  createRequestContext,
  type SqlBatchStatement,
  type SqlExecutor,
  type SqlResult,
  type SqlStatement,
} from "@guild/kernel";
import { createAuditEvent } from "@guild/server/modules/audit";
import type { AnnouncementRecord } from "@guild/server/modules/announcements";
import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteAnnouncementStore } from "./announcement-store.js";

const NOW = "2026-08-09T12:00:00.000Z";
const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";
const ANNOUNCEMENT = "announcement-1";
const PUBLIC_SCOPE = { kind: "public" } as const;
const OWNED_SCOPE = { kind: "owned", ownerUserId: OWNER } as const;
const ALL_SCOPE = { kind: "all" } as const;
const ATTACHMENT_IDS = ["ddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeee"] as const;
const databases: DatabaseSync[] = [];

class RejectSnapshotExecutor implements SqlExecutor {
  constructor(
    private readonly delegate: SqliteTestExecutor,
    private readonly rejects: (statement: SqlBatchStatement) => boolean,
  ) {}

  async execute(statement: SqlStatement): Promise<SqlResult> {
    return this.delegate.execute(statement);
  }

  async batch(statements: readonly SqlBatchStatement[]): Promise<readonly SqlResult[]> {
    return this.delegate.batch(statements.map((statement): SqlBatchStatement => this.rejects(statement)
      ? {
          method: "all",
          columns: ["snapshot_failure"],
          sql: "SELECT missing_announcement_snapshot_column",
          params: [],
        }
      : statement));
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteAnnouncementStore", () => {
  it("rolls the announcement and audit back when its in-batch detail snapshot fails", async () => {
    const { database, executor } = fixture();
    const failingExecutor = new RejectSnapshotExecutor(
      executor,
      (statement) => statement.columns?.includes("author_display_name") === true
        && statement.sql.includes("FROM announcements"),
    );
    const store = new SqliteAnnouncementStore(failingExecutor);

    await expect(store.create({
      record: announcementRecord(),
      mediaIds: [],
      attachmentMediaIds: [],
      maxItems: 100,
      maxAttachmentItems: 5,
      audit: announcementAudit("announcement-snapshot-failure"),
    })).rejects.toThrow(/missing_announcement_snapshot_column/);

    expect(database.prepare("SELECT count(*) AS count FROM announcements WHERE id = ?").get(ANNOUNCEMENT))
      .toMatchObject({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM audit_log WHERE subject_id = ?").get(ANNOUNCEMENT))
      .toMatchObject({ count: 0 });
  });

  it("returns a body-free list summary while detail retains the full rich body", async () => {
    const { database, store } = fixture();
    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20_000) }] }] });
    insertAnnouncement(database, body);

    const page = await store.list({ page: 1, limit: 20, sort: "updated_desc", readScope: PUBLIC_SCOPE, now: NOW });
    expect(page.data[0]).not.toHaveProperty("body_json");
    expect(page.data[0]?.excerpt).toBe("x".repeat(280));
    expect(page.data[0]?.author).toEqual({ id: OWNER, display_name: "Owner", avatar_media_id: null });
    const detail = await store.get(ANNOUNCEMENT, PUBLIC_SCOPE, NOW);
    expect(detail?.body_json).toBe(body);
    expect(detail?.excerpt).toBe("x".repeat(280));
  });

  it("lets a create-only author read public and owned non-public announcements, never another author's", async () => {
    const { database, store } = fixture();
    database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token)
      VALUES (?, 'Other owner', 'member', 'other-owner-revision-0001')`).run(OTHER_OWNER);
    insertAnnouncementState(database, "public-other", OTHER_OWNER, "published");
    insertAnnouncementState(database, "draft-own", OWNER, "draft");
    insertAnnouncementState(database, "draft-other", OTHER_OWNER, "draft");
    insertAnnouncementState(database, "archived-own", OWNER, "archived");
    insertAnnouncementState(database, "archived-other", OTHER_OWNER, "archived");

    const owned = await store.list({ page: 1, limit: 20, sort: "updated_desc", readScope: OWNED_SCOPE, now: NOW });
    expect(new Set(owned.data.map(({ id }) => id))).toEqual(new Set(["public-other", "draft-own", "archived-own"]));
    await expect(store.get("public-other", OWNED_SCOPE, NOW)).resolves.not.toBeNull();
    await expect(store.get("draft-own", OWNED_SCOPE, NOW)).resolves.not.toBeNull();
    await expect(store.get("archived-own", OWNED_SCOPE, NOW)).resolves.not.toBeNull();
    await expect(store.get("draft-other", OWNED_SCOPE, NOW)).resolves.toBeNull();
    await expect(store.get("archived-other", OWNED_SCOPE, NOW)).resolves.toBeNull();
    await expect(store.incrementView("public-other", OWNED_SCOPE, NOW)).resolves.toBe(1);
    await expect(store.incrementView("draft-own", OWNED_SCOPE, NOW)).resolves.toBe(1);
    await expect(store.incrementView("draft-other", OWNED_SCOPE, NOW)).resolves.toBeNull();
    const ownedDrafts = await store.list({
      page: 1,
      limit: 20,
      status: "draft",
      sort: "updated_desc",
      readScope: OWNED_SCOPE,
      now: NOW,
    });
    expect(ownedDrafts.data.map(({ id }) => id)).toEqual(["draft-own"]);

    const publicPage = await store.list({ page: 1, limit: 20, sort: "updated_desc", readScope: PUBLIC_SCOPE, now: NOW });
    expect(publicPage.data.map(({ id }) => id)).toEqual(["public-other"]);
    const managedPage = await store.list({ page: 1, limit: 20, sort: "updated_desc", readScope: ALL_SCOPE, now: NOW });
    expect(managedPage.total).toBe(5);
  });

  it("orders managed attachments and omits private attachment metadata from public detail", async () => {
    const { database, store } = fixture();
    insertAnnouncement(database, '{"type":"doc","content":[]}');
    insertAttachment(database, ATTACHMENT_IDS[0], "public-guide.pdf", "public", 1);
    insertAttachment(database, ATTACHMENT_IDS[1], "private-plan.guildpack", "private", 0);

    const publicDetail = await store.get(ANNOUNCEMENT, PUBLIC_SCOPE, NOW);
    const ownedDetail = await store.get(ANNOUNCEMENT, OWNED_SCOPE, NOW);
    const otherOwnedDetail = await store.get(
      ANNOUNCEMENT,
      { kind: "owned", ownerUserId: OTHER_OWNER },
      NOW,
    );
    const managedDetail = await store.get(ANNOUNCEMENT, ALL_SCOPE, NOW);

    expect(publicDetail?.attachments).toEqual([expect.objectContaining({ media_id: ATTACHMENT_IDS[0] })]);
    expect(ownedDetail?.attachments.map(({ media_id }) => media_id)).toEqual([ATTACHMENT_IDS[1], ATTACHMENT_IDS[0]]);
    expect(otherOwnedDetail?.attachments).toEqual([expect.objectContaining({ media_id: ATTACHMENT_IDS[0] })]);
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

  it("uses the category default-list index without a temporary order B-tree", async () => {
    const { database, executor, store } = fixture();
    insertAnnouncement(database, '{"type":"doc","content":[]}');

    await store.list({
      page: 1,
      limit: 20,
      category: "announcement",
      sort: "updated_desc",
      readScope: PUBLIC_SCOPE,
      now: NOW,
    });

    const statement = executor.batches.at(-1)?.[1];
    if (!statement) throw new Error("Expected category announcement list statement");
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
      .all(...(statement.params ?? [])) as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_announcements_category_public");
    expect(detail).not.toContain("USE TEMP B-TREE");
  });

  it("keeps managed category lists on an order-compatible index", async () => {
    const { database, executor, store } = fixture();
    insertAnnouncement(database, '{"type":"doc","content":[]}');

    await store.list({
      page: 1,
      limit: 20,
      category: "announcement",
      sort: "updated_desc",
      readScope: ALL_SCOPE,
      now: NOW,
    });

    const statement = executor.batches.at(-1)?.[1];
    if (!statement) throw new Error("Expected managed category announcement list statement");
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
      .all(...(statement.params ?? [])) as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_announcements_category_manage");
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
    id, title, body_json, pinned, status, publish_at, created_by, revision_token, created_at, updated_at, search_text
  ) VALUES (?, 'Notice', ?, 0, 'published', ?, ?, 'revision-original-0001', ?, ?, ?)`)
    .run(ANNOUNCEMENT, bodyJson, NOW, OWNER, NOW, NOW, extractTipTapText(bodyJson));
}

function insertAnnouncementState(
  database: DatabaseSync,
  id: string,
  ownerUserId: string,
  status: "draft" | "published" | "archived",
): void {
  const publishAt = status === "draft" ? null : NOW;
  const archivedAt = status === "archived" ? NOW : null;
  database.prepare(`INSERT INTO announcements (
    id, title, body_json, pinned, status, publish_at, archived_at, created_by,
    revision_token, created_at, updated_at, search_text
  ) VALUES (?, ?, '{"type":"doc","content":[]}', 0, ?, ?, ?, ?, ?, ?, ?, '')`)
    .run(id, id, status, publishAt, archivedAt, ownerUserId, `revision-${id}-0001`, NOW, NOW);
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
  const contentType = originalName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
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
    category: "announcement",
    pinned: false,
    view_count: 0,
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
