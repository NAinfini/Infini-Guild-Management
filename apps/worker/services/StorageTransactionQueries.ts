import { toTransactionPayload, type TransactionJoinedRow } from "./StorageServicePayloads";

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
