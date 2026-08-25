import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { inboxNotificationSchema } from "@guild/shared";
import { applyAppMigrations } from "../testing/app-migrations.js";
import { SqliteTestExecutor } from "../testing/sqlite-test-executor.js";
import { SqliteNotificationInboxStore } from "./notification-inbox-store.js";

const ADMIN = "admin-user";
const MEMBER = "member-user";
const JOINED = "joined-user";
const NOW = new Date().toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();
const databases: DatabaseSync[] = [];

type InboxRow = Readonly<{
  id: string;
  user_id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  source_key: string;
  payload_json: string;
  occurred_at: string;
  read_at: string | null;
}>;

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("SqliteNotificationInboxStore", () => {
  it("fans one published source out to a 200-member guild", () => {
    const { database } = fixture();
    for (let index = 0; index < 198; index += 1) {
      insertUser(database, `member-${index}`, `Member ${index}`, "member");
    }
    database.exec("DELETE FROM notification_inbox");

    insertAnnouncement(database, "announcement-200", "Guild notice", "published", PAST);

    expect(sourceRows(database, "announcement_published:announcement-200")).toHaveLength(200);
  });

  it("fans out each source exactly once, keeps member joins off the new member, and isolates read state", async () => {
    const { database, store } = fixture();

    insertUser(database, JOINED, "Joined Member", "member");
    insertAnnouncement(database, "announcement-published", "Published announcement", "published", PAST);
    insertAnnouncement(database, "announcement-draft", "Draft announcement", "draft", null);
    insertAnnouncement(database, "announcement-future", "Future announcement", "published", FUTURE);
    insertEvent(database);
    insertWikiArticle(database);

    const memberJoined = sourceRows(database, `member_joined:${JOINED}`);
    expect(memberJoined.map(({ user_id }) => user_id).sort()).toEqual([ADMIN, MEMBER]);
    expect(memberJoined.some(({ user_id }) => user_id === JOINED)).toBe(false);

    for (const sourceKey of [
      "announcement_published:announcement-published",
      "event_created:event-1",
      "wiki_article_created:article-1",
    ]) {
      expect(sourceRows(database, sourceKey).map(({ user_id }) => user_id).sort()).toEqual([ADMIN, JOINED, MEMBER]);
    }
    expect(sourceRows(database, "announcement_published:announcement-draft")).toEqual([]);
    expect(sourceRows(database, "announcement_published:announcement-future")).toEqual([]);

    database.prepare("UPDATE announcements SET status = 'scheduled' WHERE id = 'announcement-published'").run();
    database.prepare("UPDATE announcements SET status = 'published' WHERE id = 'announcement-published'").run();
    expect(sourceRows(database, "announcement_published:announcement-published")).toHaveLength(3);

    const parsed = inboxRows(database).map((row) => inboxNotificationSchema.parse({
      id: row.id,
      kind: row.kind,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      payload: JSON.parse(row.payload_json),
      occurred_at: row.occurred_at,
      read_at: row.read_at,
    }));
    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "member_joined",
        entity_type: "member",
        entity_id: JOINED,
        payload: { display_name: "Joined Member" },
      }),
      expect.objectContaining({
        kind: "announcement_published",
        entity_type: "announcement",
        entity_id: "announcement-published",
        payload: { title: "Published announcement" },
      }),
      expect.objectContaining({
        kind: "event_created",
        entity_type: "event",
        entity_id: "event-1",
        payload: { title: "Event title", start_at: PAST },
      }),
      expect.objectContaining({
        kind: "wiki_article_created",
        entity_type: "wiki_article",
        entity_id: "article-1",
        payload: { title: "Wiki title", slug: "wiki-title" },
      }),
    ]));

    const adminNotification = sourceRows(database, "announcement_published:announcement-published")
      .find(({ user_id }) => user_id === ADMIN);
    const memberNotification = sourceRows(database, "announcement_published:announcement-published")
      .find(({ user_id }) => user_id === MEMBER);
    expect(adminNotification).toBeDefined();
    expect(memberNotification).toBeDefined();
    const adminId = adminNotification!.id;
    const memberId = memberNotification!.id;

    expect(await store.markRead({ userId: ADMIN, ids: [adminId], now: NOW })).toBe(3);
    expect(readAt(database, adminId)).toBe(NOW);
    expect(readAt(database, memberId)).toBeNull();
  });

  it("paginates in stable order and exposes only the last three days without writing on the read path", async () => {
    const { database, store } = fixture();
    const minuteAgo = new Date(Date.parse(NOW) - 60_000).toISOString();
    const twoMinutesAgo = new Date(Date.parse(NOW) - 120_000).toISOString();
    const expired = new Date(Date.parse(NOW) - 4 * 24 * 60 * 60_000).toISOString();

    insertInbox(database, ADMIN, "notification-newest", NOW, null);
    insertInbox(database, ADMIN, "notification-middle", minuteAgo, null);
    insertInbox(database, ADMIN, "notification-readxx", twoMinutesAgo, PAST);
    insertInbox(database, ADMIN, "notification-expired", expired, null);
    insertInbox(database, MEMBER, "notification-memberx", NOW, null);

    const firstPage = await store.list({ userId: ADMIN, limit: 2, cursor: null, now: NOW });
    expect(firstPage.data.map(({ id }) => id)).toEqual(["notification-newest", "notification-middle"]);
    expect(firstPage.unreadCount).toBe(2);
    expect(firstPage.nextCursor).toEqual({ occurredAt: minuteAgo, id: "notification-middle" });

    const secondPage = await store.list({
      userId: ADMIN,
      limit: 2,
      cursor: firstPage.nextCursor,
      now: NOW,
    });
    expect(secondPage.data.map(({ id }) => id)).toEqual(["notification-readxx"]);
    expect(secondPage.nextCursor).toBeNull();

    const allRecent = await store.list({ userId: ADMIN, limit: 20, cursor: null, now: NOW });
    expect(allRecent.data.map(({ id }) => id)).toEqual([
      "notification-newest",
      "notification-middle",
      "notification-readxx",
    ]);
    expect(database.prepare("SELECT id FROM notification_inbox WHERE id = ?").get("notification-expired"))
      .toEqual({ id: "notification-expired" });

    expect(await store.markRead({ userId: ADMIN, ids: null, now: NOW })).toBe(0);
    expect(readAt(database, "notification-memberx")).toBeNull();
  });

  it("includes the exact three-day boundary and excludes an older notification", async () => {
    const { database, store } = fixture();
    const cutoff = new Date(Date.parse(NOW) - 3 * 24 * 60 * 60_000).toISOString();
    const expired = new Date(Date.parse(cutoff) - 1).toISOString();

    insertInbox(database, ADMIN, "notification-at-cutoff", cutoff, null);
    insertInbox(database, ADMIN, "notification-before-cutoff", expired, null);

    const page = await store.list({ userId: ADMIN, limit: 20, cursor: null, now: NOW });

    expect(page.data.map(({ id }) => id)).toEqual(["notification-at-cutoff"]);
    expect(page.unreadCount).toBe(1);
  });
});

function fixture(): { database: DatabaseSync; store: SqliteNotificationInboxStore } {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  applyAppMigrations(database);
  insertUser(database, ADMIN, "Admin User", "admin");
  insertUser(database, MEMBER, "Member User", "member");
  database.exec("DELETE FROM notification_inbox");
  return { database, store: new SqliteNotificationInboxStore(new SqliteTestExecutor(database)) };
}

function insertUser(database: DatabaseSync, id: string, displayName: string, roleId: string): void {
  database.prepare(`INSERT INTO users (id, display_name, role_id, revision_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, displayName, roleId, `${id}-revision-token-0001`, PAST, PAST);
}

function insertAnnouncement(
  database: DatabaseSync,
  id: string,
  title: string,
  status: "draft" | "published",
  publishAt: string | null,
): void {
  database.prepare(`INSERT INTO announcements
    (id, title, body_json, pinned, status, publish_at, expires_at, archived_at, created_by, updated_by, revision_token, created_at, updated_at)
    VALUES (?, ?, '{"type":"doc","content":[]}', 0, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?)`)
    .run(id, title, status, publishAt, ADMIN, `${id}-revision-token-0001`, PAST, PAST);
}

function insertEvent(database: DatabaseSync): void {
  database.prepare(`INSERT INTO events (id, type, title, start_at, created_by, created_at, updated_at)
    VALUES ('event-1', 'other', 'Event title', ?, ?, ?, ?)`)
    .run(PAST, ADMIN, PAST, PAST);
}

function insertWikiArticle(database: DatabaseSync): void {
  database.prepare(`INSERT INTO wiki_categories (id, name, slug, revision_token, created_at, updated_at)
    VALUES ('category-1', 'Category', 'category', 'category-revision-token-0001', ?, ?)`).run(PAST, PAST);
  database.prepare(`INSERT INTO wiki_articles
    (id, title, slug, category_id, body_json, created_by, revision_token, created_at, updated_at)
    VALUES ('article-1', 'Wiki title', 'wiki-title', 'category-1', '{"type":"doc","content":[]}', ?, 'article-revision-token-0001', ?, ?)`)
    .run(ADMIN, PAST, PAST);
}

function insertInbox(
  database: DatabaseSync,
  userId: string,
  id: string,
  occurredAt: string,
  readAt: string | null,
): void {
  database.prepare(`INSERT INTO notification_inbox
    (id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at)
    VALUES (?, ?, 'announcement_published', 'announcement', ?, ?, '{"title":"Inbox test"}', ?, ?)`)
    .run(id, userId, id, `source:${id}`, occurredAt, readAt);
}

function inboxRows(database: DatabaseSync): readonly InboxRow[] {
  return database.prepare(`SELECT id, user_id, kind, entity_type, entity_id, source_key, payload_json, occurred_at, read_at
    FROM notification_inbox ORDER BY source_key, user_id`).all() as InboxRow[];
}

function sourceRows(database: DatabaseSync, sourceKey: string): readonly InboxRow[] {
  return inboxRows(database).filter(({ source_key }) => source_key === sourceKey);
}

function readAt(database: DatabaseSync, id: string): string | null {
  const row = database.prepare("SELECT read_at FROM notification_inbox WHERE id = ?").get(id) as { read_at: string | null } | undefined;
  if (!row) throw new Error(`Notification ${id} was not found`);
  return row.read_at;
}
