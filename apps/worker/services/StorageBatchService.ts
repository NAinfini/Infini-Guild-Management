import {
  createStorageBatchTransactionSchema,
  storageBatchTransactionResultSchema,
  type StorageBatchTransactionResult,
  type StorageTransaction,
} from "@guild/shared";
import { nanoid } from "nanoid";
import type { SessionUser } from "./auth";
import { err, ok, type ServiceResult } from "./result";
import type { StorageServiceDeps } from "./StorageService";
import {
  getStorageBatchPreflight,
  parseStorageBatchAuditDetail,
  type NormalizedStorageBatchRequest,
  type StorageBatchAuditDetail,
  type StorageBatchPreflightRow,
} from "./StorageTransactionQueries";

function sameRequest(
  first: NormalizedStorageBatchRequest,
  second: NormalizedStorageBatchRequest,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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
  return sessionUser.permissions.has("admin.storage.stock")
    || sessionUser.permissions.has("admin.storage.manage");
}

function replayOrConflict(
  rows: StorageBatchPreflightRow[],
  request: NormalizedStorageBatchRequest,
): ServiceResult<StorageBatchTransactionResult> | null {
  const markerRow = rows.find((row) => row.markerId !== null);
  if (!markerRow) return null;
  const marker = parseStorageBatchAuditDetail(markerRow.markerDetailText);
  if (!marker) return err("SERVER_ERROR", "Stored batch idempotency marker is invalid");
  if (!sameRequest(marker.request, request)) {
    return err("CONFLICT", "Idempotency key was already used with a different request");
  }
  return ok({ data: marker.response.data, replayed: true });
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

function createMarkerStatement(
  context: StorageBatchContext,
  response: StorageBatchTransactionResult,
  createdAt: string,
): D1PreparedStatement {
  const detail: StorageBatchAuditDetail = {
    kind: "storage_batch",
    version: 1,
    request: context.request,
    response,
  };
  return context.deps.rawDb.prepare(`
    INSERT INTO audit_log
      (id, entity_type, action, actor_id, entity_id, diff_title, detail_text, created_at)
    VALUES (?1, 'storage_transaction', ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    context.markerId,
    context.request.type,
    context.sessionUser.id,
    context.markerId,
    `Batch ${context.request.type} (${response.data.length})`,
    JSON.stringify(detail),
    createdAt,
  );
}

function createMarkerArtifactStatement(
  context: StorageBatchContext,
): D1PreparedStatement | null {
  const runId = context.deps.systemTestRunId;
  if (!runId) return null;
  return context.deps.rawDb.prepare(
    `INSERT INTO system_test_artifacts (run_id, artifact_type, artifact_key)
     VALUES (
       (SELECT id FROM system_test_runs WHERE id = ? AND status = 'running'),
       'audit_log',
       ?
     )
     ON CONFLICT(run_id, artifact_type, artifact_key)
     DO UPDATE SET artifact_key = excluded.artifact_key`,
  ).bind(runId, context.markerId);
}

function createItemStatements(
  context: StorageBatchContext,
  transaction: StorageTransaction,
  createdAt: string,
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
      (id, item_id, type, quantity_delta, recipient_user_id, note, actor_id, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    transaction.id,
    transaction.item_id,
    transaction.type,
    transaction.quantity_delta,
    transaction.recipient_user_id,
    transaction.note,
    transaction.actor_id,
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
  const markerArtifact = createMarkerArtifactStatement(context);
  const statements = [
    createMarkerStatement(context, response, createdAt),
    ...(markerArtifact ? [markerArtifact] : []),
    ...transactions.flatMap((transaction) =>
      createItemStatements(context, transaction, createdAt)),
  ];
  try {
    await context.deps.rawDb.batch(statements);
  } catch (error) {
    const currentRows = await context.preflight();
    const replay = replayOrConflict(currentRows, context.request);
    if (replay) return replay;
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
    markerId,
    actorId: sessionUser.id,
    recipientUserId,
  });

  const context: StorageBatchContext = {
    deps,
    sessionUser,
    manager,
    recipientUserId,
    request,
    markerId,
    preflight,
  };
  const rows = await preflight();
  const replay = replayOrConflict(rows, request);
  if (replay) return replay;
  if (rows.length !== request.entries.length) {
    return err("SERVER_ERROR", "Storage batch preflight returned an incomplete result");
  }
  const preflightError = validateSnapshot(rows, request, manager, recipientUserId, false);
  if (preflightError) return preflightError;
  return commitBatch(context, rows);
}
