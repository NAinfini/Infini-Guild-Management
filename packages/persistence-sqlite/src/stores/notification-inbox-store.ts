import type { InboxNotification, NotificationPreferences } from "@guild/shared";
import { NOTIFICATION_INBOX_RETENTION_DAYS, inboxNotificationSchema } from "@guild/shared";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  NotificationInboxStore,
} from "@guild/server/modules/notifications";
import { auditInsertStatement } from "./audit-statement.js";

const INBOX_COLUMNS = [
  "id", "kind", "entity_type", "entity_id", "payload_json", "occurred_at", "read_at",
] as const;

export class SqliteNotificationInboxStore implements NotificationInboxStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(input: Parameters<NotificationInboxStore["list"]>[0]) {
    const cutoff = retentionCutoff(input.now);
    const cursor = input.cursor;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: INBOX_COLUMNS,
        sql: `SELECT id, kind, entity_type, entity_id, payload_json, occurred_at, read_at
          FROM notification_inbox INDEXED BY idx_notification_inbox_user_occurred
          WHERE user_id = ? AND occurred_at >= ?
            ${cursor === null ? "" : "AND (occurred_at < ? OR (occurred_at = ? AND id < ?))"}
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?`,
        params: [
          input.userId,
          cutoff,
          ...(cursor === null ? [] : [cursor.occurredAt, cursor.occurredAt, cursor.id]),
          input.limit + 1,
        ],
      },
      {
        method: "get",
        columns: ["unread_count"],
        sql: `SELECT COUNT(*) AS unread_count FROM notification_inbox
          WHERE user_id = ? AND occurred_at >= ? AND read_at IS NULL`,
        params: [input.userId, cutoff],
      },
    ]);
    const entries = allRows(required(results[0], "Notification inbox page")).map(mapNotification);
    const unreadCount = numberCell(required(results[1], "Notification inbox count"), "Notification inbox unread count");
    const visible = entries.slice(0, input.limit);
    const last = visible.at(-1);
    return {
      data: visible,
      nextCursor: entries.length > input.limit && last
        ? { occurredAt: last.occurred_at, id: last.id }
        : null,
      unreadCount,
    };
  }

  async markRead(input: Parameters<NotificationInboxStore["markRead"]>[0]): Promise<number> {
    const cutoff = retentionCutoff(input.now);
    const ids = input.ids === null ? null : JSON.stringify(input.ids);
    const results = await this.sql.batch([
      {
        method: "run",
        sql: `UPDATE notification_inbox SET read_at = ?
          WHERE user_id = ? AND occurred_at >= ? AND read_at IS NULL
            ${ids === null ? "" : "AND id IN (SELECT value FROM json_each(?))"}`,
        params: ids === null ? [input.now, input.userId, cutoff] : [input.now, input.userId, cutoff, ids],
      },
      {
        method: "get",
        columns: ["unread_count"],
        sql: `SELECT COUNT(*) AS unread_count FROM notification_inbox
          WHERE user_id = ? AND occurred_at >= ? AND read_at IS NULL`,
        params: [input.userId, cutoff],
      },
    ]);
    return numberCell(required(results[1], "Notification inbox count"), "Notification inbox unread count");
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await this.sql.execute({
      method: "get",
      columns: ["member_joined", "announcement_published", "event_created", "wiki_article_created", "updated_at"],
      sql: `SELECT member_joined, announcement_published, event_created, wiki_article_created, updated_at
        FROM notification_preferences WHERE user_id = ?`,
      params: [userId],
    });
    const row = oneRow(result);
    return row ? mapPreferences(row) : defaultPreferences();
  }

  async updatePreferences(input: Parameters<NotificationInboxStore["updatePreferences"]>[0]): Promise<NotificationPreferences> {
    const memberJoined = booleanValue(input.patch.member_joined);
    const announcementPublished = booleanValue(input.patch.announcement_published);
    const eventCreated = booleanValue(input.patch.event_created);
    const wikiArticleCreated = booleanValue(input.patch.wiki_article_created);
    const results = await this.sql.batch([
      {
        method: "get",
        columns: ["member_joined", "announcement_published", "event_created", "wiki_article_created", "updated_at"],
        sql: `INSERT INTO notification_preferences
          (user_id, member_joined, announcement_published, event_created, wiki_article_created, updated_at)
          VALUES (?, coalesce(?, 1), coalesce(?, 1), coalesce(?, 1), coalesce(?, 1), ?)
          ON CONFLICT(user_id) DO UPDATE SET
            member_joined = coalesce(?, notification_preferences.member_joined),
            announcement_published = coalesce(?, notification_preferences.announcement_published),
            event_created = coalesce(?, notification_preferences.event_created),
            wiki_article_created = coalesce(?, notification_preferences.wiki_article_created),
            updated_at = excluded.updated_at
          RETURNING member_joined, announcement_published, event_created, wiki_article_created, updated_at`,
        params: [
          input.userId,
          memberJoined,
          announcementPublished,
          eventCreated,
          wikiArticleCreated,
          input.now,
          memberJoined,
          announcementPublished,
          eventCreated,
          wikiArticleCreated,
        ],
      },
      auditInsertStatement(input.audit),
    ]);
    const row = oneRow(required(results[0], "Notification preference update"));
    if (!row) throw new TypeError("Notification preference update returned no row");
    return mapPreferences(row);
  }

}

function mapNotification(row: readonly SqlValue[]): InboxNotification {
  const [id, kind, entityType, entityId, payloadJson, occurredAt, readAt] = row;
  if (
    typeof id !== "string" || typeof kind !== "string" || typeof entityType !== "string"
    || typeof entityId !== "string" || typeof payloadJson !== "string" || typeof occurredAt !== "string"
    || (readAt !== null && typeof readAt !== "string")
  ) {
    throw new TypeError("Invalid notification inbox row");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson) as unknown;
  } catch {
    throw new TypeError("Invalid notification inbox payload");
  }
  return inboxNotificationSchema.parse({
    id,
    kind,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    occurred_at: occurredAt,
    read_at: readAt,
  });
}

function retentionCutoff(now: string): string {
  const value = Date.parse(now);
  if (!Number.isFinite(value)) throw new TypeError("Notification inbox clock is invalid");
  return new Date(value - NOTIFICATION_INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
}

function required(result: SqlResult | undefined, label: string): SqlResult {
  if (!result) throw new TypeError(`${label} result is missing`);
  return result;
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) {
    throw new TypeError("Invalid notification inbox rows");
  }
  return result.rows as readonly (readonly SqlValue[])[];
}

function numberCell(result: SqlResult, label: string): number {
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw new TypeError(`${label} row is invalid`);
  }
  const value = result.rows[0];
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
  return value;
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) {
    throw new TypeError("Invalid notification preference row");
  }
  return result.rows.length === 0 ? null : result.rows as readonly SqlValue[];
}

function mapPreferences(row: readonly SqlValue[]): NotificationPreferences {
  const [memberJoined, announcementPublished, eventCreated, wikiArticleCreated, updatedAt] = row;
  if ((memberJoined !== 0 && memberJoined !== 1)
    || (announcementPublished !== 0 && announcementPublished !== 1)
    || (eventCreated !== 0 && eventCreated !== 1)
    || (wikiArticleCreated !== 0 && wikiArticleCreated !== 1)
    || typeof updatedAt !== "string") {
    throw new TypeError("Invalid notification preferences");
  }
  return {
    member_joined: memberJoined === 1,
    announcement_published: announcementPublished === 1,
    event_created: eventCreated === 1,
    wiki_article_created: wikiArticleCreated === 1,
    updated_at: updatedAt,
  };
}

function defaultPreferences(): NotificationPreferences {
  return {
    member_joined: true,
    announcement_published: true,
    event_created: true,
    wiki_article_created: true,
    updated_at: null,
  };
}

function booleanValue(value: boolean | undefined): 0 | 1 | null {
  return value === undefined ? null : value ? 1 : 0;
}
