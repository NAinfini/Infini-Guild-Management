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
  type AuditChange,
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
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";
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
  audit: AuditEventWrite;
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
  createStorage(input: Readonly<{ storage: Storage; audit: AuditEventWrite }>): Promise<"created" | "limit_reached">;
  updateStorage(input: Readonly<{
    id: string;
    patch: Readonly<{ name?: string; description?: string | null }>;
    updatedAt: string;
    audit: AuditEventWrite;
  }>): Promise<Storage | null>;
  deleteStorage(id: string, audit: AuditEventWrite): Promise<StorageDeleteResult>;
  createCategory(input: Readonly<{
    storageId: string;
    category: StorageCategory;
    createdAt: string;
    audit: AuditEventWrite;
  }>): Promise<StoragePlacement>;
  updateCategory(input: Readonly<{
    storageId: string;
    categoryId: string;
    name: string;
    audit: AuditEventWrite;
  }>): Promise<StorageCategory | null>;
  deleteCategory(storageId: string, categoryId: string, audit: AuditEventWrite): Promise<StorageDeleteResult>;
  listItems(query: StorageItemsListQuery): Promise<CursorResponse<StorageItemRecord>>;
  getItem(itemId: string): Promise<StorageItemRecord | null>;
  validateItemPlacement(storageId: string, categoryId: string | null): Promise<StoragePlacement>;
  createItem(item: StorageItemRecord, audit: AuditEventWrite): Promise<void>;
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
    audit: AuditEventWrite;
  }>): Promise<StorageItemRecord | null>;
  deleteItem(itemId: string, audit: AuditEventWrite): Promise<StorageDeleteResult>;
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
    audit: AuditEventWrite;
  }>): Promise<readonly string[]>;
  detachItemImage(input: Readonly<{
    context: RequestContext;
    itemId: string;
    mediaId: string;
    audit: AuditEventWrite;
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
    const audit = createAuditEvent(context, {
      subjectType: "storage",
      subjectId: storage.id,
      subjectLabel: storage.name,
      action: "create",
      context: [],
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
    const id = requiredId(storageId, "storage");
    const existing = (await this.store.getTree()).data.find((storage) => storage.id === id);
    if (!existing) throw notFound("Storage not found");
    const patch: { name?: string; description?: string | null } = {};
    const changes: AuditChange[] = [];
    if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
      patch.name = parsed.data.name;
      changes.push({
        field: "name",
        before: { type: "text", value: existing.name },
        after: { type: "text", value: parsed.data.name },
      });
    }
    if (parsed.data.description !== undefined && parsed.data.description !== existing.description) {
      patch.description = parsed.data.description;
      changes.push({
        field: "description",
        before: existing.description === null
          ? { type: "null", value: null }
          : { type: "text", value: existing.description },
        after: parsed.data.description === null
          ? { type: "null", value: null }
          : { type: "text", value: parsed.data.description },
      });
    }
    if (changes.length === 0) return existing;
    const audit = createAuditEvent(context, {
      subjectType: "storage",
      subjectId: id,
      subjectLabel: patch.name ?? existing.name,
      action: "update",
      changes,
    });
    const storage = await this.store.updateStorage({
      id,
      patch,
      updatedAt: context.now,
      audit,
    });
    if (!storage) throw notFound("Storage not found");
    return this.changed(storage, storageId, context.now);
  }

  async deleteStorage(context: RequestContext, storageId: string): Promise<{ ok: true }> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const id = requiredId(storageId, "storage");
    const existing = (await this.store.getTree()).data.find((storage) => storage.id === id);
    if (!existing) throw notFound("Storage not found");
    const audit = createAuditEvent(context, {
      subjectType: "storage",
      subjectId: id,
      subjectLabel: existing.name,
      action: "delete",
      context: [],
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
    const targetStorageId = requiredId(storageId, "storage");
    const storage = (await this.store.getTree()).data.find(({ id }) => id === targetStorageId);
    if (!storage) throw notFound("Storage not found");
    const category = { id: this.createId(), name: parsed.data.name };
    const audit = createAuditEvent(context, {
      subjectType: "storage_category",
      subjectId: category.id,
      subjectLabel: category.name,
      action: "create",
      context: [{
        field: "storage_id",
        value: { type: "reference", value: { id: targetStorageId, label: storage.name } },
      }],
    });
    const placement = await this.store.createCategory({
      storageId: targetStorageId,
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
    const id = requiredId(categoryId, "category");
    const storage = (await this.store.getTree()).data.find((item) => item.id === storageId);
    const existing = storage?.categories.find((category) => category.id === id);
    if (!existing) throw notFound("Category not found");
    if (parsed.data.name === existing.name) return existing;
    const audit = createAuditEvent(context, {
      subjectType: "storage_category",
      subjectId: id,
      subjectLabel: parsed.data.name,
      action: "update",
      changes: [{
        field: "name",
        before: { type: "text", value: existing.name },
        after: { type: "text", value: parsed.data.name },
      }],
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
    const storage = (await this.store.getTree()).data.find((item) => item.id === storageId);
    const existing = storage?.categories.find((category) => category.id === id);
    if (!storage || !existing) throw notFound("Category not found");
    const audit = createAuditEvent(context, {
      subjectType: "storage_category",
      subjectId: id,
      subjectLabel: existing.name,
      action: "delete",
      context: [{
        field: "storage_id",
        value: { type: "reference", value: { id: storage.id, label: storage.name } },
      }],
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
    const [placement, tree] = await Promise.all([
      this.store.validateItemPlacement(parsed.data.storage_id, categoryId),
      this.store.getTree(),
    ]);
    assertPlacement(placement);
    const storage = tree.data.find(({ id }) => id === parsed.data.storage_id);
    if (!storage) throw notFound("Storage not found");
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
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: item.id,
      subjectLabel: item.name,
      action: "create",
      context: [{
        field: "storage_id",
        value: { type: "reference", value: { id: item.storage_id, label: storage.name } },
      }],
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
    let tree: { data: Storage[] } | null = null;
    if (parsed.data.category_id !== undefined) {
      assertPlacement(await this.store.validateItemPlacement(current.storage_id, parsed.data.category_id));
      tree = await this.store.getTree();
    }
    const patch: {
      categoryId?: string | null;
      name?: string;
      description?: string | null;
      allowMemberDeposit?: boolean;
      allowMemberWithdraw?: boolean;
    } = {};
    const changes: AuditChange[] = [];
    const sectionKeys: string[] = [];
    if (parsed.data.category_id !== undefined && parsed.data.category_id !== current.category_id) {
      patch.categoryId = parsed.data.category_id;
      const storage = tree!.data.find(({ id: storageId }) => storageId === current.storage_id);
      const labelFor = (categoryId: string | null) => categoryId === null
        ? null
        : storage?.categories.find(({ id: candidateId }) => candidateId === categoryId)?.name ?? null;
      changes.push({
        field: "category_id",
        before: current.category_id === null
          ? { type: "null", value: null }
          : { type: "reference", value: { id: current.category_id, label: labelFor(current.category_id) } },
        after: parsed.data.category_id === null
          ? { type: "null", value: null }
          : { type: "reference", value: { id: parsed.data.category_id, label: labelFor(parsed.data.category_id) } },
      });
    }
    if (parsed.data.name !== undefined && parsed.data.name !== current.name) {
      patch.name = parsed.data.name;
      changes.push({
        field: "name",
        before: { type: "text", value: current.name },
        after: { type: "text", value: parsed.data.name },
      });
    }
    if (parsed.data.description !== undefined && (parsed.data.description ?? null) !== current.description) {
      patch.description = parsed.data.description ?? null;
      sectionKeys.push("description");
    }
    if (parsed.data.allow_member_deposit !== undefined
      && parsed.data.allow_member_deposit !== current.allow_member_deposit) {
      patch.allowMemberDeposit = parsed.data.allow_member_deposit;
      sectionKeys.push("allow_member_deposit");
    }
    if (parsed.data.allow_member_withdraw !== undefined
      && parsed.data.allow_member_withdraw !== current.allow_member_withdraw) {
      patch.allowMemberWithdraw = parsed.data.allow_member_withdraw;
      sectionKeys.push("allow_member_withdraw");
    }
    if (changes.length === 0 && sectionKeys.length === 0) return (await this.withMedia([current]))[0]!;
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: parsed.data.name ?? current.name,
      action: "update",
      changes,
      context: sectionKeys.length === 0 ? [] : [{
        field: "changed_sections",
        value: {
          type: "list",
          value: sectionKeys.map((value) => ({ type: "code" as const, value })),
        },
      }],
    });
    let item: StorageItemRecord | null;
    try {
      item = await this.store.updateItem({
        id,
        patch,
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
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    const storage = (await this.store.getTree()).data.find(({ id: storageId }) => storageId === item.storage_id);
    if (!storage) throw notFound("Storage not found");
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: item.name,
      action: "delete",
      context: [{
        field: "storage_id",
        value: { type: "reference", value: { id: storage.id, label: storage.name } },
      }],
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
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: item.name,
      action: "upload_images",
      context: [{ field: "upload_count", value: { type: "number", value: uploads.length } }],
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
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: item.name,
      action: "delete_images",
      context: [{ field: "media_count", value: { type: "number", value: 1 } }],
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
    if (recipientUserId !== null && snapshot.recipientUsername === null) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Recipient username is unavailable" });
    }
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
    const audit = createAuditEvent(context, {
      subjectType: "storage_transaction",
      subjectId: batchId,
      subjectLabel: transactions.length === 1 ? transactions[0]!.item_name : null,
      action: input.type,
      context: [
        { field: "transaction_count", value: { type: "number", value: transactions.length } },
        { field: "type", value: { type: "code", value: input.type } },
        {
          field: "item_ids",
          value: {
            type: "list",
            value: transactions.map(({ item_id: id, item_name: label }) => ({
              type: "reference" as const,
              value: { id, label },
            })),
          },
        },
        {
          field: "quantity",
          value: {
            type: "list",
            value: transactions.map(({ quantity_delta: quantity }) => ({ type: "number" as const, value: quantity })),
          },
        },
        ...(recipientUserId === null ? [] : [{
          field: "user_ids" as const,
          value: {
            type: "list" as const,
            value: [{
              type: "reference" as const,
              value: { id: recipientUserId, label: snapshot.recipientUsername },
            }],
          },
        }]),
      ],
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
