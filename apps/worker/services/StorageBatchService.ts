import {
  createStorageBatchTransactionSchema,
  storageBatchTransactionResultSchema,
  type StorageBatchTransactionResult,
  type StorageTransaction,
} from "@guild/shared";
import { nanoid } from "nanoid";
import type { SessionUser } from "./auth";
import { buildAuditLogInsertStatement } from "./audit";
import { err, ok, type ServiceResult } from "./result";
import type { StorageServiceDeps } from "./StorageService";
import {
  getStorageBatchReplay,
  getStorageBatchPreflight,
  type NormalizedStorageBatchRequest,
  type StorageBatchPreflightRow,
  type StorageBatchReplayState,
  type StoredStorageBatchRequest,
} from "./StorageTransactionQueries";

function sameRequest(
  stored: StoredStorageBatchRequest,
  requested: NormalizedStorageBatchRequest,
): boolean {
  return stored.type === requested.type
    && stored.recipient_user_id === requested.recipient_user_id
    && stored.note === requested.note
    && stored.entries.length === requested.entries.length
    && stored.entries.every((entry, index) => {
      const candidate = requested.entries[index];
      return candidate?.item_id === entry.item_id && candidate.quantity === entry.quantity;
    });
}

async function getMarkerId(actorId: string, idempotencyKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${actorId}\n${idempotencyKey}`);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", data as unknown as BufferSource),
  );
  return `storage-batch-${Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function isManager(sessionUser: SessionUser): boolean {
  return sessionUser.permissions.has("admin.storage.stock");
}

function replayOrConflict(
  replay: StorageBatchReplayState,
  request: NormalizedStorageBatchRequest,
): ServiceResult<StorageBatchTransactionResult> | null {
  if (replay.kind === "missing") return null;
  if (replay.kind === "corrupt") {
    return err("SERVER_ERROR", "Stored storage batch is incomplete or invalid");
  }
  if (!sameRequest(replay.request, request)) {
    return err("CONFLICT", "Idempotency key was already used with a different request");
  }
  return ok({ data: replay.response.data, replayed: true });
}

function validateSnapshot(
  rows: StorageBatchPreflightRow[],
  request: NormalizedStorageBatchRequest,
  manager: boolean,
  recipientUserId: string | null,
  conflict: boolean,
): ServiceResult<never> | null {
  const missing = rows.find((row) => row.itemId === null);
  if (missing) return err("NOT_FOUND", "Item not found", { item_id: missing.requestedItemId });
  if (!rows[0]?.actorId) return err("UNAUTHORIZED", "Authentication required");
  if (recipientUserId !== null && rows[0]?.recipientId === null) {
    return err("NOT_FOUND", "Recipient not found");
  }
  if (!manager) {
    const blocked = rows.find((row) => request.type === "intake"
      ? !Boolean(row.allowMemberDeposit)
      : !Boolean(row.allowMemberWithdraw));
    if (blocked) {
      return err(
        "FORBIDDEN",
        "This item does not allow member self-service for this operation",
        { item_id: blocked.requestedItemId },
      );
    }
  }
  if (request.type === "distribute") {
    const insufficient = rows.find(
      (row) => (row.itemQuantity ?? 0) < row.requestedQuantity,
    );
    if (insufficient) {
      return err(
        conflict ? "CONFLICT" : "VALIDATION_ERROR",
        conflict
          ? "Stock changed; refresh and retry"
          : `Insufficient stock (have ${insufficient.itemQuantity ?? 0})`,
        {
          item_id: insufficient.requestedItemId,
          current_quantity: insufficient.itemQuantity ?? 0,
          requested_quantity: insufficient.requestedQuantity,
        },
      );
    }
  }
  return null;
}

type StorageBatchContext = {
  deps: StorageServiceDeps;
  sessionUser: SessionUser;
  manager: boolean;
  recipientUserId: string | null;
  request: NormalizedStorageBatchRequest;
  markerId: string;
  preflight: () => Promise<StorageBatchPreflightRow[]>;
  replay: () => Promise<StorageBatchReplayState>;
};

function createTransactions(
  rows: StorageBatchPreflightRow[],
  context: StorageBatchContext,
  createdAt: string,
): StorageTransaction[] {
  return rows.map((row) => ({
    id: nanoid(),
    item_id: row.requestedItemId,
    item_name: row.itemName,
    type: context.request.type,
    quantity_delta: context.request.type === "intake"
      ? row.requestedQuantity
      : -row.requestedQuantity,
    recipient_user_id: context.recipientUserId,
    recipient_username: row.recipientUsername,
    note: context.request.note,
    actor_id: context.sessionUser.id,
    actor_username: row.actorUsername,
    created_at: createdAt,
  }));
}

function createBatchStatement(
  context: StorageBatchContext,
  createdAt: string,
): D1PreparedStatement {
  return context.deps.rawDb.prepare(
    "INSERT INTO storage_batches (id, actor_id, created_at) VALUES (?1, ?2, ?3)",
  ).bind(context.markerId, context.sessionUser.id, createdAt);
}

function createSystemTestArtifactStatement(
  context: StorageBatchContext,
  type: "storage_batch" | "audit_log",
  key: string,
): D1PreparedStatement | null {
  const runId = context.deps.systemTestRunId;
  if (!runId) return null;
  return context.deps.rawDb.prepare(
    `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
     VALUES (
       (SELECT id FROM system_test_runs WHERE id = ? AND status = 'running'),
       ?,
       ?
     )
     ON CONFLICT(run_id, artifact_type, artifact_key)
     DO UPDATE SET artifact_key = excluded.artifact_key`,
  ).bind(runId, type, key);
}

function createItemStatements(
  context: StorageBatchContext,
  transaction: StorageTransaction,
  createdAt: string,
  batchPosition: number,
): D1PreparedStatement[] {
  const permissionFlag = context.request.type === "intake"
    ? "allow_member_deposit"
    : "allow_member_withdraw";
  const update = context.manager
    ? context.deps.rawDb
      .prepare(
        "UPDATE storage_items SET quantity = quantity + ?1, updated_at = ?2 WHERE id = ?3",
      )
      .bind(transaction.quantity_delta, createdAt, transaction.item_id)
    : context.deps.rawDb.prepare(`
        UPDATE storage_items
        SET quantity = CASE
          WHEN ${permissionFlag} = 1 THEN quantity + ?1
          ELSE -1
        END, updated_at = ?2
        WHERE id = ?3
      `).bind(transaction.quantity_delta, createdAt, transaction.item_id);
  const insert = context.deps.rawDb.prepare(`
    INSERT INTO storage_transactions
      (id, item_id, type, quantity_delta, recipient_user_id, note, actor_id, batch_id, batch_position, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `).bind(
    transaction.id,
    transaction.item_id,
    transaction.type,
    transaction.quantity_delta,
    transaction.recipient_user_id,
    transaction.note,
    transaction.actor_id,
    context.markerId,
    batchPosition,
    transaction.created_at,
  );
  return [update, insert];
}

async function commitBatch(
  context: StorageBatchContext,
  rows: StorageBatchPreflightRow[],
): Promise<ServiceResult<StorageBatchTransactionResult>> {
  const createdAt = new Date().toISOString();
  const transactions = createTransactions(rows, context, createdAt);
  const response = storageBatchTransactionResultSchema.parse({
    data: transactions,
    replayed: false,
  });
  const audit = buildAuditLogInsertStatement(context.deps.rawDb, {
    entityType: "storage_transaction",
    action: context.request.type,
    actorId: context.sessionUser.id,
    entityId: context.markerId,
    diffTitle: `Batch ${context.request.type} (${transactions.length})`,
    detail: {
      batch_id: context.markerId,
      type: context.request.type,
      entries: context.request.entries,
      recipient_user_id: context.recipientUserId,
      note: context.request.note,
      transaction_ids: transactions.map((transaction) => transaction.id),
    },
  }, { createdAt });
  const batchArtifact = createSystemTestArtifactStatement(
    context,
    "storage_batch",
    context.markerId,
  );
  const auditArtifact = createSystemTestArtifactStatement(context, "audit_log", audit.id);
  const statements = [
    createBatchStatement(context, createdAt),
    ...(batchArtifact ? [batchArtifact] : []),
    ...transactions.flatMap((transaction, position) =>
      createItemStatements(context, transaction, createdAt, position)),
    audit.statement,
    ...(auditArtifact ? [auditArtifact] : []),
  ];
  try {
    await context.deps.rawDb.batch(statements);
  } catch (error) {
    const replay = replayOrConflict(await context.replay(), context.request);
    if (replay) return replay;
    const currentRows = await context.preflight();
    if (currentRows.length !== context.request.entries.length) {
      return err("SERVER_ERROR", "Storage batch diagnostic returned an incomplete result");
    }
    const diagnostic = validateSnapshot(
      currentRows,
      context.request,
      context.manager,
      context.recipientUserId,
      true,
    );
    if (diagnostic) return diagnostic;
    throw error;
  }
  await context.deps.publishEntityChanged({
    entityType: "storage",
    entityId: context.markerId,
    hint: "storage_updated",
  });
  return ok(response);
}

export async function applyStorageBatchTransactions(
  deps: StorageServiceDeps, sessionUser: SessionUser, body: unknown,
): Promise<ServiceResult<StorageBatchTransactionResult>> {
  const parsed = createStorageBatchTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Invalid batch transaction payload", parsed.error.flatten());
  }

  const manager = isManager(sessionUser);
  if (manager && parsed.data.type === "distribute" && !parsed.data.recipient_user_id) {
    return err("VALIDATION_ERROR", "recipient_user_id required for distribute");
  }

  const recipientUserId = manager ? parsed.data.recipient_user_id ?? null : sessionUser.id;
  const request: NormalizedStorageBatchRequest = {
    idempotency_key: parsed.data.idempotency_key,
    type: parsed.data.type,
    entries: [...parsed.data.entries]
      .map((entry) => ({ item_id: entry.item_id, quantity: entry.quantity }))
      .sort((a, b) => a.item_id.localeCompare(b.item_id)),
    recipient_user_id: recipientUserId,
    note: parsed.data.note ?? null,
  };
  const markerId = await getMarkerId(sessionUser.id, request.idempotency_key);
  const preflight = () => getStorageBatchPreflight(deps.rawDb, {
    entries: request.entries.map((entry) => ({
      itemId: entry.item_id,
      quantity: entry.quantity,
    })),
    actorId: sessionUser.id,
    recipientUserId,
  });
  const replay = () => getStorageBatchReplay(deps.rawDb, markerId, sessionUser.id);

  const context: StorageBatchContext = {
    deps,
    sessionUser,
    manager,
    recipientUserId,
    request,
    markerId,
    preflight,
    replay,
  };
  const existing = replayOrConflict(await replay(), request);
  if (existing) return existing;
  const rows = await preflight();
  if (rows.length !== request.entries.length) {
    return err("SERVER_ERROR", "Storage batch preflight returned an incomplete result");
  }
  const preflightError = validateSnapshot(rows, request, manager, recipientUserId, false);
  if (preflightError) return preflightError;
  return commitBatch(context, rows);
}
