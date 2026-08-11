import {
  createStorageBatchTransactionSchema,
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  storageItemsListQuerySchema,
  storageTransactionsListQuerySchema,
  updateStorageItemSchema,
  type CreateStorageBatchTransactionPayload,
  type CreateStorageTransactionPayload,
  type CursorResponse,
  type PaginatedResponse,
  type Storage,
  type StorageBatchTransactionResult,
  type StorageCategory,
  type StorageItem,
  type StorageItemsListQuery,
  type StorageTransaction,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import {
  AppError,
  type DeferredTasks,
  type NotificationPublisher,
  type RequestContext,
} from "@guild/kernel";
import { createAuditMutation, type AuditMutation } from "../audit/public.js";
import type { ImageUpload } from "../media/public.js";

const STRUCTURE_PERMISSION = PERMISSION_ID.ADMIN_STORAGE_STRUCTURE;
const ITEMS_PERMISSION = PERMISSION_ID.ADMIN_STORAGE_ITEMS;
const STOCK_PERMISSION = PERMISSION_ID.ADMIN_STORAGE_STOCK;

export type StorageItemRecord = Omit<StorageItem, "images">;

export type StoragePlacement = "valid" | "storage_missing" | "category_missing" | "category_mismatch" | "limit_reached";
export type StorageDeleteResult = "deleted" | "not_found" | "not_empty" | "has_ledger";

export type StockSubmissionEntry = Readonly<{
  itemId: string;
  quantity: number;
}>;

export type StockSnapshotEntry = Readonly<{
  position: number;
  requestedItemId: string;
  requestedQuantity: number;
  item: StorageItemRecord | null;
}>;

export type StockSubmissionSnapshot = Readonly<{
  entries: readonly StockSnapshotEntry[];
  actorExists: boolean;
  actorUsername: string | null;
  recipientExists: boolean;
  recipientUsername: string | null;
}>;

export type NormalizedStockRequest = Readonly<{
  type: "intake" | "distribute" | "adjust";
  entries: readonly StockSubmissionEntry[];
  recipientUserId: string | null;
  note: string | null;
}>;

export type StoredStorageBatch = Readonly<{
  id: string;
  request: NormalizedStockRequest;
  transactions: readonly StorageTransaction[];
}>;

export type StockCommit = Readonly<{
  batchId: string;
  actorId: string;
  idempotencyKey: string | null;
  accessMode: "stock_admin" | "member_self";
  request: NormalizedStockRequest;
  targetQuantity: number | null;
  createdAt: string;
  transactions: readonly StorageTransaction[];
  audit: AuditMutation;
}>;

export type StorageLedgerQuery = Readonly<{
  actorId: string;
  canViewAll: boolean;
  itemId?: string;
  recipientUserId?: string;
  page: number;
  limit: number;
}>;

export interface StorageStore {
  getTree(): Promise<{ data: Storage[] }>;
  createStorage(input: Readonly<{ storage: Storage; audit: AuditMutation }>): Promise<"created" | "limit_reached">;
  updateStorage(input: Readonly<{
    id: string;
    patch: Readonly<{ name?: string; description?: string | null }>;
    updatedAt: string;
    audit: AuditMutation;
  }>): Promise<Storage | null>;
  deleteStorage(id: string, audit: AuditMutation): Promise<StorageDeleteResult>;
  createCategory(input: Readonly<{
    storageId: string;
    category: StorageCategory;
    createdAt: string;
    audit: AuditMutation;
  }>): Promise<StoragePlacement>;
  updateCategory(input: Readonly<{
    storageId: string;
    categoryId: string;
    name: string;
    audit: AuditMutation;
  }>): Promise<StorageCategory | null>;
  deleteCategory(storageId: string, categoryId: string, audit: AuditMutation): Promise<StorageDeleteResult>;
  listItems(query: StorageItemsListQuery): Promise<CursorResponse<StorageItemRecord>>;
  getItem(itemId: string): Promise<StorageItemRecord | null>;
  validateItemPlacement(storageId: string, categoryId: string | null): Promise<StoragePlacement>;
  createItem(item: StorageItemRecord, audit: AuditMutation): Promise<void>;
  updateItem(input: Readonly<{
    id: string;
    patch: Readonly<{
      categoryId?: string | null;
      name?: string;
      description?: string | null;
      allowMemberDeposit?: boolean;
      allowMemberWithdraw?: boolean;
    }>;
    updatedAt: string;
    audit: AuditMutation;
  }>): Promise<StorageItemRecord | null>;
  deleteItem(itemId: string, audit: AuditMutation): Promise<StorageDeleteResult>;
  getSubmissionSnapshot(
    actorId: string,
    recipientUserId: string | null,
    entries: readonly StockSubmissionEntry[],
  ): Promise<StockSubmissionSnapshot>;
  findBatch(actorId: string, idempotencyKey: string): Promise<StoredStorageBatch | null>;
  commitStock(commit: StockCommit): Promise<readonly StorageTransaction[]>;
  listLedger(query: StorageLedgerQuery): Promise<PaginatedResponse<StorageTransaction>>;
}

export interface StorageMediaPort {
  listItemMediaIds(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
  attachItemImages(input: Readonly<{
    context: RequestContext;
    itemId: string;
    uploads: readonly ImageUpload[];
    audit: AuditMutation;
  }>): Promise<readonly string[]>;
  detachItemImage(input: Readonly<{
    context: RequestContext;
    itemId: string;
    mediaId: string;
    audit: AuditMutation;
  }>): Promise<boolean>;
}

export type StorageStoreErrorCode =
  | "invalid_cursor"
  | "ineffective_delta"
  | "no_change"
  | "negative_balance"
  | "authorization_changed"
  | "idempotency_conflict"
  | "foreign_key"
  | "constraint";

export class StorageStoreError extends Error {
  override readonly name = "StorageStoreError";

  constructor(readonly code: StorageStoreErrorCode, options?: ErrorOptions) {
    super(code, options);
  }
}

export class StorageService {
  constructor(
    private readonly store: StorageStore,
    private readonly media: StorageMediaPort,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async getTree(context: RequestContext): Promise<{ data: Storage[] }> {
    context.authorization.requireAuthenticated();
    return this.store.getTree();
  }

  async createStorage(context: RequestContext, body: unknown): Promise<Storage> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = createStorageSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid storage payload", parsed.error.flatten());
    const storage: Storage = {
      id: this.createId(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      created_at: context.now,
      categories: [],
    };
    const audit = createAuditMutation(context, {
      entityType: "storage",
      entityId: storage.id,
      action: "create",
      summary: storage.name,
    });
    if (await this.store.createStorage({ storage, audit }) === "limit_reached") {
      throw invalid("Storage structure limit reached");
    }
    return this.changed(storage, storage.id, context.now);
  }

  async updateStorage(context: RequestContext, storageId: string, body: unknown): Promise<Storage> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = createStorageSchema.partial().safeParse(body);
    if (!parsed.success) throw invalid("Invalid storage payload", parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) throw invalid("No fields to update");
    const audit = createAuditMutation(context, {
      entityType: "storage",
      entityId: requiredId(storageId, "storage"),
      action: "update",
      summary: parsed.data.name ?? null,
    });
    const storage = await this.store.updateStorage({
      id: storageId,
      patch: parsed.data,
      updatedAt: context.now,
      audit,
    });
    if (!storage) throw notFound("Storage not found");
    return this.changed(storage, storageId, context.now);
  }

  async deleteStorage(context: RequestContext, storageId: string): Promise<{ ok: true }> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const id = requiredId(storageId, "storage");
    const audit = createAuditMutation(context, {
      entityType: "storage",
      entityId: id,
      action: "delete",
    });
    const result = await this.store.deleteStorage(id, audit);
    if (result === "not_found") throw notFound("Storage not found");
    if (result !== "deleted") throw conflict("Storage must be empty before deletion");
    return this.changed({ ok: true }, id, context.now);
  }

  async createCategory(
    context: RequestContext,
    storageId: string,
    body: unknown,
  ): Promise<StorageCategory> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = createStorageCategorySchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid category payload", parsed.error.flatten());
    const category = { id: this.createId(), name: parsed.data.name };
    const audit = createAuditMutation(context, {
      entityType: "storage_category",
      entityId: category.id,
      action: "create",
      summary: category.name,
    });
    const placement = await this.store.createCategory({
      storageId: requiredId(storageId, "storage"),
      category,
      createdAt: context.now,
      audit,
    });
    if (placement === "limit_reached") throw invalid("Storage category limit reached");
    if (placement !== "valid") throw notFound("Storage not found");
    return this.changed(category, storageId, context.now);
  }

  async updateCategory(
    context: RequestContext,
    storageId: string,
    categoryId: string,
    body: unknown,
  ): Promise<StorageCategory> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = createStorageCategorySchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid category payload", parsed.error.flatten());
    const audit = createAuditMutation(context, {
      entityType: "storage_category",
      entityId: requiredId(categoryId, "category"),
      action: "update",
      summary: parsed.data.name,
    });
    const category = await this.store.updateCategory({
      storageId: requiredId(storageId, "storage"),
      categoryId,
      name: parsed.data.name,
      audit,
    });
    if (!category) throw notFound("Category not found");
    return this.changed(category, storageId, context.now);
  }

  async deleteCategory(
    context: RequestContext,
    storageId: string,
    categoryId: string,
  ): Promise<{ ok: true }> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const id = requiredId(categoryId, "category");
    const audit = createAuditMutation(context, {
      entityType: "storage_category",
      entityId: id,
      action: "delete",
    });
    const result = await this.store.deleteCategory(requiredId(storageId, "storage"), id, audit);
    if (result === "not_found") throw notFound("Category not found");
    if (result !== "deleted") throw conflict("Category must be empty before deletion");
    return this.changed({ ok: true }, storageId, context.now);
  }

  async listItems(context: RequestContext, raw: unknown): Promise<CursorResponse<StorageItem>> {
    context.authorization.requireAuthenticated();
    const parsed = storageItemsListQuerySchema.safeParse(raw);
    if (!parsed.success) throw invalid("Invalid storage item query", parsed.error.flatten());
    let result: CursorResponse<StorageItemRecord>;
    try {
      result = await this.store.listItems(parsed.data);
    } catch (error) {
      if (error instanceof StorageStoreError && error.code === "invalid_cursor") {
        throw invalid("Invalid storage item cursor");
      }
      throw error;
    }
    return {
      data: await this.withMedia(result.data),
      next_cursor: result.next_cursor,
    };
  }

  async getItem(context: RequestContext, itemId: string): Promise<StorageItem> {
    context.authorization.requireAuthenticated();
    const item = await this.store.getItem(requiredId(itemId, "item"));
    if (!item) throw notFound("Item not found");
    return (await this.withMedia([item]))[0]!;
  }

  async createItem(context: RequestContext, body: unknown): Promise<StorageItem> {
    context.authorization.require(ITEMS_PERMISSION);
    const parsed = createStorageItemSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid item payload", parsed.error.flatten());
    const categoryId = parsed.data.category_id ?? null;
    assertPlacement(await this.store.validateItemPlacement(parsed.data.storage_id, categoryId));
    const item: StorageItemRecord = {
      id: this.createId(),
      storage_id: parsed.data.storage_id,
      category_id: categoryId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      quantity: 0,
      allow_member_deposit: parsed.data.allow_member_deposit,
      allow_member_withdraw: parsed.data.allow_member_withdraw,
      created_at: context.now,
      updated_at: context.now,
    };
    const audit = createAuditMutation(context, {
      entityType: "storage_item",
      entityId: item.id,
      action: "create",
      summary: item.name,
    });
    try {
      await this.store.createItem(item, audit);
    } catch (error) {
      throw placementRace(error);
    }
    return this.changed({ ...item, images: [] }, item.id, context.now);
  }

  async updateItem(context: RequestContext, itemId: string, body: unknown): Promise<StorageItem> {
    context.authorization.require(ITEMS_PERMISSION);
    const parsed = updateStorageItemSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid item payload", parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) throw invalid("No fields to update");
    const id = requiredId(itemId, "item");
    const current = await this.store.getItem(id);
    if (!current) throw notFound("Item not found");
    if (parsed.data.category_id !== undefined) {
      assertPlacement(await this.store.validateItemPlacement(current.storage_id, parsed.data.category_id));
    }
    const audit = createAuditMutation(context, {
      entityType: "storage_item",
      entityId: id,
      action: "update",
      summary: parsed.data.name ?? current.name,
    });
    let item: StorageItemRecord | null;
    try {
      item = await this.store.updateItem({
        id,
        patch: {
          ...(parsed.data.category_id !== undefined ? { categoryId: parsed.data.category_id } : {}),
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.allow_member_deposit !== undefined
            ? { allowMemberDeposit: parsed.data.allow_member_deposit }
            : {}),
          ...(parsed.data.allow_member_withdraw !== undefined
            ? { allowMemberWithdraw: parsed.data.allow_member_withdraw }
            : {}),
        },
        updatedAt: context.now,
        audit,
      });
    } catch (error) {
      throw placementRace(error);
    }
    if (!item) throw notFound("Item not found");
    return this.changed((await this.withMedia([item]))[0]!, id, context.now);
  }

  async deleteItem(context: RequestContext, itemId: string): Promise<{ ok: true }> {
    context.authorization.require(ITEMS_PERMISSION);
    const id = requiredId(itemId, "item");
    const audit = createAuditMutation(context, {
      entityType: "storage_item",
      entityId: id,
      action: "delete",
    });
    const result = await this.store.deleteItem(id, audit);
    if (result === "not_found") throw notFound("Item not found");
    if (result !== "deleted") throw conflict("Storage items with transaction history cannot be deleted");
    return this.changed({ ok: true }, id, context.now);
  }

  async uploadImages(
    context: RequestContext,
    itemId: string,
    uploads: readonly ImageUpload[],
  ): Promise<Array<{ media_id: string }>> {
    context.authorization.require(ITEMS_PERMISSION);
    const id = requiredId(itemId, "item");
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    const audit = createAuditMutation(context, {
      entityType: "storage_item",
      entityId: id,
      action: "upload_images",
      summary: item.name,
      details: { count: uploads.length },
    });
    const mediaIds = await this.media.attachItemImages({ context, itemId: id, uploads, audit });
    return this.changed(mediaIds.map((mediaId) => ({ media_id: mediaId })), id, context.now);
  }

  async deleteImage(
    context: RequestContext,
    itemId: string,
    mediaId: string,
  ): Promise<{ ok: true }> {
    context.authorization.require(ITEMS_PERMISSION);
    const id = requiredId(itemId, "item");
    const media = requiredId(mediaId, "media");
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    const audit = createAuditMutation(context, {
      entityType: "storage_item",
      entityId: id,
      action: "delete_images",
      summary: item.name,
      details: { media_id: media },
    });
    if (!await this.media.detachItemImage({ context, itemId: id, mediaId: media, audit })) {
      throw notFound("Image not found");
    }
    return this.changed({ ok: true }, id, context.now);
  }

  createTransaction(
    context: RequestContext,
    itemId: string,
    body: unknown,
  ): Promise<StorageTransaction> {
    const parsed = createStorageTransactionSchema.safeParse(body);
    if (!parsed.success) return Promise.reject(invalid("Invalid transaction payload", parsed.error.flatten()));
    return this.submitSingle(context, requiredId(itemId, "item"), parsed.data);
  }

  createBatchTransaction(
    context: RequestContext,
    body: unknown,
  ): Promise<StorageBatchTransactionResult> {
    const parsed = createStorageBatchTransactionSchema.safeParse(body);
    if (!parsed.success) return Promise.reject(invalid("Invalid batch transaction payload", parsed.error.flatten()));
    return this.submitBatch(context, parsed.data);
  }

  async listTransactions(
    context: RequestContext,
    raw: unknown,
  ): Promise<PaginatedResponse<StorageTransaction>> {
    const actor = context.authorization.requireAuthenticated();
    const parsed = storageTransactionsListQuerySchema.safeParse(raw);
    if (!parsed.success) throw invalid("Invalid storage transaction query", parsed.error.flatten());
    const canViewAll = context.authorization.has(STOCK_PERMISSION);
    const requestedRecipient = parsed.data.recipient_user_id;
    if (!canViewAll && requestedRecipient && requestedRecipient !== "me" && requestedRecipient !== actor.userId) {
      throw forbidden("Members may only view storage entries involving themselves");
    }
    return this.store.listLedger({
      actorId: actor.userId,
      canViewAll,
      ...(parsed.data.item_id ? { itemId: parsed.data.item_id } : {}),
      ...(requestedRecipient
        ? { recipientUserId: requestedRecipient === "me" ? actor.userId : requestedRecipient }
        : {}),
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  }

  private async submitSingle(
    context: RequestContext,
    itemId: string,
    payload: CreateStorageTransactionPayload,
  ): Promise<StorageTransaction> {
    const result = await this.submitStock(context, {
      type: payload.type,
      entries: [{ itemId, quantity: payload.quantity ?? 0 }],
      recipientUserId: payload.recipient_user_id ?? null,
      note: payload.note ?? null,
      targetQuantity: payload.target_quantity,
      idempotencyKey: null,
    });
    return result.data[0]!;
  }

  private async submitBatch(
    context: RequestContext,
    payload: CreateStorageBatchTransactionPayload,
  ): Promise<StorageBatchTransactionResult> {
    return this.submitStock(context, {
      type: payload.type,
      entries: [...payload.entries]
        .map((entry) => ({ itemId: entry.item_id, quantity: entry.quantity }))
        .sort((left, right) => left.itemId.localeCompare(right.itemId)),
      recipientUserId: payload.recipient_user_id ?? null,
      note: payload.note ?? null,
      idempotencyKey: payload.idempotency_key,
    });
  }

  private async submitStock(
    context: RequestContext,
    input: Readonly<{
      type: "intake" | "distribute" | "adjust";
      entries: readonly StockSubmissionEntry[];
      recipientUserId: string | null;
      note: string | null;
      targetQuantity?: number;
      idempotencyKey: string | null;
    }>,
  ): Promise<StorageBatchTransactionResult> {
    const actor = context.authorization.requireAuthenticated();
    const manager = context.authorization.has(STOCK_PERMISSION);
    if (!manager && input.recipientUserId !== null && input.recipientUserId !== actor.userId) {
      throw forbidden("Members cannot submit storage transactions for another user");
    }
    if (!manager && input.type === "adjust") {
      throw forbidden("Stock adjustment requires admin.storage.stock");
    }
    if (manager && input.type === "distribute" && input.recipientUserId === null) {
      throw invalid("recipient_user_id required for distribute");
    }
    const recipientUserId = manager
      ? (input.type === "adjust" ? null : input.recipientUserId)
      : actor.userId;
    const normalizedRequest: NormalizedStockRequest = {
      type: input.type,
      entries: input.entries,
      recipientUserId,
      note: input.note,
    };

    if (input.idempotencyKey) {
      const existing = await this.store.findBatch(actor.userId, input.idempotencyKey);
      if (existing) return replay(existing, normalizedRequest);
    }

    const snapshot = await this.store.getSubmissionSnapshot(actor.userId, recipientUserId, input.entries);
    if (!snapshot.actorExists) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    if (recipientUserId !== null && !snapshot.recipientExists) throw notFound("Recipient not found");
    const missing = snapshot.entries.find((entry) => entry.item === null);
    if (missing) throw notFound("Item not found", { item_id: missing.requestedItemId });

    if (!manager) {
      const blocked = snapshot.entries.find(({ item }) => input.type === "intake"
        ? !item!.allow_member_deposit
        : !item!.allow_member_withdraw);
      if (blocked) {
        throw forbidden("This item does not allow member self-service for this operation", {
          item_id: blocked.requestedItemId,
        });
      }
    }

    const createdAt = context.now;
    const batchId = this.createId();
    const transactions = snapshot.entries.map((entry) => {
      const item = entry.item!;
      const delta = input.type === "adjust"
        ? (input.targetQuantity! - item.quantity)
        : input.type === "intake"
          ? entry.requestedQuantity
          : -entry.requestedQuantity;
      if (delta === 0 && input.type !== "adjust") throw invalid("Quantity change must be non-zero");
      if (item.quantity + delta < 0) {
        throw invalid(`Insufficient stock (have ${item.quantity})`, {
          item_id: item.id,
          current_quantity: item.quantity,
          requested_quantity: entry.requestedQuantity,
        });
      }
      return {
        id: this.createId(),
        item_id: item.id,
        item_name: item.name,
        type: input.type,
        quantity_delta: delta,
        recipient_user_id: recipientUserId,
        recipient_username: snapshot.recipientUsername,
        note: input.note,
        actor_id: actor.userId,
        actor_username: snapshot.actorUsername,
        created_at: createdAt,
      } satisfies StorageTransaction;
    });
    const audit = createAuditMutation(context, {
      entityType: "storage_transaction",
      entityId: batchId,
      action: input.type,
      summary: `${input.type} (${transactions.length})`,
      details: {
        batch_id: batchId,
        entries: input.entries.map((entry) => ({ item_id: entry.itemId, quantity: entry.quantity })),
        target_quantity: input.type === "adjust" ? input.targetQuantity ?? null : null,
        recipient_user_id: recipientUserId,
        transaction_ids: transactions.map((transaction) => transaction.id),
      },
    });
    const commit: StockCommit = {
      batchId,
      actorId: actor.userId,
      idempotencyKey: input.idempotencyKey,
      accessMode: manager ? "stock_admin" : "member_self",
      request: normalizedRequest,
      targetQuantity: input.type === "adjust" ? input.targetQuantity ?? null : null,
      createdAt,
      transactions,
      audit,
    };
    try {
      const committedTransactions = await this.store.commitStock(commit);
      return this.changed({ data: [...committedTransactions], replayed: false }, batchId, context.now);
    } catch (error) {
      if (error instanceof StorageStoreError) {
        if (error.code === "idempotency_conflict" && input.idempotencyKey) {
          const existing = await this.store.findBatch(actor.userId, input.idempotencyKey);
          if (existing) return replay(existing, normalizedRequest);
        }
        if (error.code === "negative_balance") throw conflict("Stock changed; refresh and retry");
        if (error.code === "no_change") throw invalid("Target quantity is already current stock");
        if (error.code === "ineffective_delta") throw invalid("Quantity change is below storage precision");
        if (error.code === "authorization_changed") {
          throw forbidden("Storage self-service permission changed; refresh and retry");
        }
        if (error.code === "foreign_key") throw conflict("Storage data changed; refresh and retry");
      }
      throw error;
    }
  }

  private async withMedia(items: readonly StorageItemRecord[]): Promise<StorageItem[]> {
    if (items.length === 0) return [];
    const media = await this.media.listItemMediaIds(items.map((item) => item.id));
    return items.map((item) => ({
      ...item,
      images: (media.get(item.id) ?? []).map((mediaId) => ({ media_id: mediaId })),
    }));
  }

  private changed<T>(
    data: T,
    entityId: string,
    occurredAt: string,
  ): T {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "storage",
      entity_id: entityId,
      updated_at: occurredAt,
      hint: "storage_updated",
    }));
    return data;
  }
}

function replay(
  stored: StoredStorageBatch,
  requested: NormalizedStockRequest,
): StorageBatchTransactionResult {
  if (!sameRequest(stored.request, requested)) {
    throw conflict("Idempotency key was already used with a different request");
  }
  return { data: [...stored.transactions], replayed: true };
}

function sameRequest(stored: NormalizedStockRequest, requested: NormalizedStockRequest): boolean {
  return stored.type === requested.type
    && stored.recipientUserId === requested.recipientUserId
    && stored.note === requested.note
    && stored.entries.length === requested.entries.length
    && stored.entries.every((entry, index) => {
      const next = requested.entries[index];
      return next?.itemId === entry.itemId && next.quantity === entry.quantity;
    });
}

function assertPlacement(placement: StoragePlacement): void {
  if (placement === "valid") return;
  if (placement === "limit_reached") throw invalid("Storage category limit reached");
  if (placement === "storage_missing") throw notFound("Storage not found");
  if (placement === "category_missing") throw notFound("Category not found");
  throw invalid("Category does not belong to storage");
}

function placementRace(error: unknown): AppError | unknown {
  if (error instanceof StorageStoreError && error.code === "foreign_key") {
    return conflict("Storage or category changed; refresh and retry");
  }
  return error;
}

function requiredId(value: string, name: string): string {
  const id = value.trim();
  if (!id) throw invalid(`${name} id is required`);
  return id;
}

function invalid(message: string, details?: unknown): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message, details });
}

function forbidden(message: string, details?: unknown): AppError {
  return new AppError({ code: "FORBIDDEN", status: 403, message, details });
}

function notFound(message: string, details?: unknown): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message, details });
}

function conflict(message: string, details?: unknown): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message, details });
}
