import type { InboxNotification } from "@guild/shared";
import { NOTIFICATION_INBOX_RETENTION_DAYS, inboxNotificationSchema } from "@guild/shared";
import type { SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import type {
  NotificationInboxStore,
} from "@guild/server/modules/notifications";

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
