import {
  createStorageBatchTransactionSchema,
  storageBatchTransactionResultSchema,
  type StorageBatchTransactionResult,
} from "@guild/shared";
import { toTransactionPayload, type TransactionJoinedRow } from "./StorageServicePayloads";

export type NormalizedStorageBatchRequest = {
  idempotency_key: string;
  type: "intake" | "distribute";
  entries: Array<{ item_id: string; quantity: number }>;
  recipient_user_id: string | null;
  note: string | null;
};

export type StorageBatchAuditDetail = {
  kind: "storage_batch";
  version: 1;
  request: NormalizedStorageBatchRequest;
  response: StorageBatchTransactionResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseStorageBatchAuditDetail(
  detailText: string | null,
): StorageBatchAuditDetail | null {
  if (!detailText) return null;
  try {
    const parsed: unknown = JSON.parse(detailText);
    if (
      !isRecord(parsed)
      || parsed.kind !== "storage_batch"
      || parsed.version !== 1
      || !isRecord(parsed.request)
    ) return null;
    const response = storageBatchTransactionResultSchema.safeParse(parsed.response);
    const request = createStorageBatchTransactionSchema.safeParse(parsed.request);
    if (!response.success || !request.success) return null;
    return {
      kind: "storage_batch",
      version: 1,
      request: {
        idempotency_key: request.data.idempotency_key,
        type: request.data.type,
        entries: [...request.data.entries]
          .map((entry) => ({ item_id: entry.item_id, quantity: entry.quantity }))
          .sort((a, b) => a.item_id.localeCompare(b.item_id)),
        recipient_user_id: request.data.recipient_user_id ?? null,
        note: request.data.note ?? null,
      },
      response: response.data,
    };
  } catch {
    return null;
  }
}

export type StorageBatchPreflightRow = {
  markerId: string | null;
  markerDetailText: string | null;
  requestedItemId: string;
  requestedQuantity: number;
  itemId: string | null;
  itemName: string | null;
  itemQuantity: number | null;
  allowMemberDeposit: number | boolean | null;
  allowMemberWithdraw: number | boolean | null;
  actorId: string | null;
  actorUsername: string | null;
  recipientId: string | null;
  recipientUsername: string | null;
};

/**
 * Fetches the idempotency marker, all requested item snapshots, and both users
 * in one statement. Keeping this as one query makes the subsequent D1 batch's
 * failure diagnostics a fresh snapshot instead of a sequence of stale reads.
 */
export async function getStorageBatchPreflight(
  rawDb: D1Database,
  input: {
    entries: Array<{ itemId: string; quantity: number }>;
    markerId: string;
    actorId: string;
    recipientUserId: string | null;
  },
): Promise<StorageBatchPreflightRow[]> {
  const entryValues = input.entries.map((_, index) => `(?${index * 2 + 1}, ?${index * 2 + 2})`).join(", ");
  const trailingIndex = input.entries.length * 2;
  const rows = await rawDb.prepare(`
    WITH requested(item_id, quantity) AS (VALUES ${entryValues})
    SELECT
      marker.id AS markerId,
      marker.detail_text AS markerDetailText,
      requested.item_id AS requestedItemId,
      requested.quantity AS requestedQuantity,
      item.id AS itemId,
      item.name AS itemName,
      item.quantity AS itemQuantity,
      item.allow_member_deposit AS allowMemberDeposit,
      item.allow_member_withdraw AS allowMemberWithdraw,
      actor.id AS actorId,
      actor.username AS actorUsername,
      recipient.id AS recipientId,
      recipient.username AS recipientUsername
    FROM requested
    LEFT JOIN audit_log marker ON marker.id = ?${trailingIndex + 1}
    LEFT JOIN storage_items item ON item.id = requested.item_id
    LEFT JOIN users actor ON actor.id = ?${trailingIndex + 2}
    LEFT JOIN users recipient ON recipient.id = ?${trailingIndex + 3}
    ORDER BY requested.item_id ASC
  `).bind(
    ...input.entries.flatMap((entry) => [entry.itemId, entry.quantity]),
    input.markerId,
    input.actorId,
    input.recipientUserId,
  ).all<StorageBatchPreflightRow>();
  return rows.results ?? [];
}

export async function getStorageTransactionPayload(rawDb: D1Database, transactionId: string): Promise<unknown | null> {
  const row = (await rawDb.prepare(`
    SELECT
      tx.id,
      tx.item_id AS itemId,
      item.name AS itemName,
      tx.type,
      tx.quantity_delta AS quantityDelta,
      tx.recipient_user_id AS recipientUserId,
      recipient.username AS recipientUsername,
      tx.note,
      tx.actor_id AS actorId,
      actor.username AS actorUsername,
      tx.created_at AS createdAt
    FROM storage_transactions tx
    LEFT JOIN storage_items item ON item.id = tx.item_id
    LEFT JOIN users recipient ON recipient.id = tx.recipient_user_id
    LEFT JOIN users actor ON actor.id = tx.actor_id
    WHERE tx.id = ?1
    LIMIT 1
  `).bind(transactionId).first<TransactionJoinedRow>()) ?? null;
  return row ? toTransactionPayload(row) : null;
}

export async function listStorageTransactionPayloads(rawDb: D1Database, options: {
  itemId?: string;
  recipientUserId?: string;
  page: number;
  limit: number;
}) {
  const filters: string[] = [];
  const binds: unknown[] = [];
  if (options.itemId) {
    binds.push(options.itemId);
    filters.push(`tx.item_id = ?${binds.length}`);
  }
  if (options.recipientUserId) {
    binds.push(options.recipientUserId);
    filters.push(`tx.recipient_user_id = ?${binds.length}`);
  }
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const page = Math.max(1, options.page);
  const limit = Math.max(1, Math.min(100, options.limit));
  const count = await rawDb.prepare(`SELECT count(*) AS count FROM storage_transactions tx ${whereSql}`).bind(...binds).first<{ count: number }>();
  const rows = await rawDb.prepare(`
    SELECT
      tx.id,
      tx.item_id AS itemId,
      item.name AS itemName,
      tx.type,
      tx.quantity_delta AS quantityDelta,
      tx.recipient_user_id AS recipientUserId,
      recipient.username AS recipientUsername,
      tx.note,
      tx.actor_id AS actorId,
      actor.username AS actorUsername,
      tx.created_at AS createdAt
    FROM storage_transactions tx
    LEFT JOIN storage_items item ON item.id = tx.item_id
    LEFT JOIN users recipient ON recipient.id = tx.recipient_user_id
    LEFT JOIN users actor ON actor.id = tx.actor_id
    ${whereSql}
    ORDER BY tx.created_at DESC, tx.id DESC
    LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}
  `).bind(...binds, limit, (page - 1) * limit).all<TransactionJoinedRow>();
  const total = Number(count?.count ?? 0);
  return {
    data: (rows.results ?? []).map(toTransactionPayload),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}
