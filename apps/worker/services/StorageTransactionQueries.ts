import {
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

export type StoredStorageBatchRequest = Omit<NormalizedStorageBatchRequest, "idempotency_key">;
export type StorageBatchReplayState =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | {
      kind: "stored";
      request: StoredStorageBatchRequest;
      response: StorageBatchTransactionResult;
    };

type StorageBatchReplayRow = {
  batchId: string;
  batchActorId: string;
  batchCreatedAt: string;
  batchPosition: number | null;
  transactionId: string | null;
  itemId: string | null;
  itemName: string | null;
  type: string | null;
  quantityDelta: number | null;
  recipientUserId: string | null;
  recipientUsername: string | null;
  note: string | null;
  actorId: string | null;
  actorUsername: string | null;
  transactionCreatedAt: string | null;
};

export async function getStorageBatchReplay(
  rawDb: D1Database,
  batchId: string,
  actorId: string,
): Promise<StorageBatchReplayState> {
  const result = await rawDb.prepare(`
    SELECT
      batch.id AS batchId,
      batch.actor_id AS batchActorId,
      batch.created_at AS batchCreatedAt,
      tx.batch_position AS batchPosition,
      tx.id AS transactionId,
      tx.item_id AS itemId,
      item.name AS itemName,
      tx.type,
      tx.quantity_delta AS quantityDelta,
      tx.recipient_user_id AS recipientUserId,
      recipient.username AS recipientUsername,
      tx.note,
      tx.actor_id AS actorId,
      actor.username AS actorUsername,
      tx.created_at AS transactionCreatedAt
    FROM storage_batches batch
    LEFT JOIN storage_transactions tx ON tx.batch_id = batch.id
    LEFT JOIN storage_items item ON item.id = tx.item_id
    LEFT JOIN users recipient ON recipient.id = tx.recipient_user_id
    LEFT JOIN users actor ON actor.id = tx.actor_id
    WHERE batch.id = ?1
    ORDER BY tx.batch_position ASC
  `).bind(batchId).all<StorageBatchReplayRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return { kind: "missing" };

  const first = rows[0]!;
  if (
    first.batchId !== batchId
    || first.batchActorId !== actorId
    || first.transactionId === null
    || first.type === null
    || first.actorUsername === null
  ) return { kind: "corrupt" };

  const entries: StoredStorageBatchRequest["entries"] = [];
  const transactions: TransactionJoinedRow[] = [];
  let previousItemId: string | null = null;
  for (const [position, row] of rows.entries()) {
    if (
      row.batchId !== batchId
      || row.batchActorId !== actorId
      || row.batchCreatedAt !== first.batchCreatedAt
      || row.batchPosition !== position
      || row.transactionId === null
      || row.itemId === null
      || row.itemName === null
      || row.type !== first.type
      || (row.type !== "intake" && row.type !== "distribute")
      || row.quantityDelta === null
      || !Number.isInteger(row.quantityDelta)
      || (row.type === "intake" ? row.quantityDelta <= 0 : row.quantityDelta >= 0)
      || row.recipientUserId !== first.recipientUserId
      || row.note !== first.note
      || row.actorId !== actorId
      || row.actorUsername === null
      || row.transactionCreatedAt !== first.batchCreatedAt
      || (row.recipientUserId !== null && row.recipientUsername === null)
      || (previousItemId !== null && previousItemId.localeCompare(row.itemId) >= 0)
    ) return { kind: "corrupt" };

    previousItemId = row.itemId;
    entries.push({
      item_id: row.itemId,
      quantity: row.type === "intake" ? row.quantityDelta : -row.quantityDelta,
    });
    transactions.push({
      id: row.transactionId,
      itemId: row.itemId,
      itemName: row.itemName,
      type: row.type,
      quantityDelta: row.quantityDelta,
      recipientUserId: row.recipientUserId,
      recipientUsername: row.recipientUsername,
      note: row.note,
      actorId: row.actorId,
      actorUsername: row.actorUsername,
      createdAt: row.transactionCreatedAt,
    });
  }

  const response = storageBatchTransactionResultSchema.safeParse({
    data: transactions.map(toTransactionPayload),
    replayed: false,
  });
  if (!response.success) return { kind: "corrupt" };
  return {
    kind: "stored",
    request: {
      type: first.type as "intake" | "distribute",
      entries,
      recipient_user_id: first.recipientUserId,
      note: first.note,
    },
    response: response.data,
  };
}

export type StorageBatchPreflightRow = {
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
 * Fetches all requested item snapshots and both users in one statement.
 * Keeping this as one query makes the subsequent D1 batch's
 * failure diagnostics a fresh snapshot instead of a sequence of stale reads.
 */
export async function getStorageBatchPreflight(
  rawDb: D1Database,
  input: {
    entries: Array<{ itemId: string; quantity: number }>;
    actorId: string;
    recipientUserId: string | null;
  },
): Promise<StorageBatchPreflightRow[]> {
  const entryValues = input.entries.map((_, index) => `(?${index * 2 + 1}, ?${index * 2 + 2})`).join(", ");
  const trailingIndex = input.entries.length * 2;
  const rows = await rawDb.prepare(`
    WITH requested(item_id, quantity) AS (VALUES ${entryValues})
    SELECT
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
    LEFT JOIN storage_items item ON item.id = requested.item_id
    LEFT JOIN users actor ON actor.id = ?${trailingIndex + 1}
    LEFT JOIN users recipient ON recipient.id = ?${trailingIndex + 2}
    ORDER BY requested.item_id ASC
  `).bind(
    ...input.entries.flatMap((entry) => [entry.itemId, entry.quantity]),
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
