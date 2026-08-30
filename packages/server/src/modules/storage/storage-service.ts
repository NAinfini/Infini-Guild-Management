import {
  createStorageBatchTransactionSchema,
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  deleteStorageCategorySchema,
  deleteStorageItemSchema,
  deleteStorageSchema,
  storageItemImageMutationSchema,
  storageItemsListQuerySchema,
  storageTransactionsListQuerySchema,
  updateStorageCategorySchema,
  updateStorageItemSchema,
  updateStorageSchema,
  type CreateStorageBatchTransactionPayload,
  type CreateStorageTransactionPayload,
  type AuditChange,
  type CursorResponse,
  type PaginatedResponse,
  type Storage,
  type StorageBatchTransactionResult,
  type StorageCategory,
  type StorageCategoryDeleteResponse,
  type StorageCategoryMutationResponse,
  type StorageItem,
  type StorageItemImageDeleteResponse,
  type StorageItemImageUploadResponse,
  type StorageRarity,
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
export type StorageDeleteResult = "deleted" | "not_found" | "not_empty" | "has_ledger" | "stale";
export type StorageCategoryCreateResult =
  | Readonly<{ status: "created"; value: StorageCategory; structureRevision: number }>
  | Readonly<{ status: "storage_missing" | "limit_reached" | "stale" }>;
export type StorageCategoryDeleteResult =
  | Readonly<{ status: "deleted"; structureRevision: number }>
  | Readonly<{ status: "not_found" | "not_empty" | "stale" }>;
export type StorageUpdateResult<T> =
  | Readonly<{ status: "updated"; value: T }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "stale" }>;
export type StorageItemMediaMutationResult =
  | Readonly<{ status: "updated"; mediaIds: readonly string[]; updatedAt: string }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "image_not_found" }>
  | Readonly<{ status: "stale" }>;

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
  targetQuantity: number | null;
}>;

export type StoredStorageBatch = Readonly<{
  id: string;
  requestFingerprint: string | null;
  transactions: readonly StorageTransaction[];
}>;

export type StockCommit = Readonly<{
  batchId: string;
  actorId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  accessMode: "stock_admin" | "member_self";
  request: NormalizedStockRequest;
  createdAt: string;
  transactions: readonly StorageTransaction[];
  audit: AuditEventWrite;
}>;

export type StorageLedgerQuery = Readonly<{
  actorId: string;
  canViewAll: boolean;
  storageId?: string;
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
    expected: Readonly<{ name: string; description: string | null; structureRevision: number }>;
    audit: AuditEventWrite;
  }>): Promise<StorageUpdateResult<Storage>>;
  deleteStorage(input: Readonly<{
    id: string;
    expectedStructureRevision: number;
    audit: AuditEventWrite;
  }>): Promise<StorageDeleteResult>;
  createCategory(input: Readonly<{
    storageId: string;
    category: StorageCategory;
    createdAt: string;
    expectedStructureRevision: number;
    audit: AuditEventWrite;
  }>): Promise<StorageCategoryCreateResult>;
  updateCategory(input: Readonly<{
    storageId: string;
    categoryId: string;
    name: string;
    expectedName: string;
    expectedStructureRevision: number;
    audit: AuditEventWrite;
  }>): Promise<StorageUpdateResult<Readonly<{ category: StorageCategory; structureRevision: number }>>>;
  deleteCategory(input: Readonly<{
    storageId: string;
    categoryId: string;
    expectedStructureRevision: number;
    audit: AuditEventWrite;
  }>): Promise<StorageCategoryDeleteResult>;
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
      rarity?: StorageRarity;
      unit?: string | null;
      allowMemberDeposit?: boolean;
      allowMemberWithdraw?: boolean;
    }>;
    expectedUpdatedAt: string;
    updatedAt: string;
    audit: AuditEventWrite;
  }>): Promise<StorageUpdateResult<StorageItemRecord>>;
  deleteItem(input: Readonly<{
    itemId: string;
    expectedUpdatedAt: string;
    audit: AuditEventWrite;
  }>): Promise<StorageDeleteResult>;
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
    expectedUpdatedAt: string;
    updatedAt: string;
    audit: AuditEventWrite;
  }>): Promise<StorageItemMediaMutationResult>;
  detachItemImage(input: Readonly<{
    context: RequestContext;
    itemId: string;
    mediaId: string;
    expectedUpdatedAt: string;
    updatedAt: string;
    audit: AuditEventWrite;
  }>): Promise<StorageItemMediaMutationResult>;
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
      structure_revision: 0,
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
    const parsed = updateStorageSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid storage payload", parsed.error.flatten());
    const id = requiredId(storageId, "storage");
    const existing = (await this.store.getTree()).data.find((storage) => storage.id === id);
    if (!existing) throw notFound("Storage not found");
    if (parsed.data.expected_name !== existing.name
      || parsed.data.expected_description !== existing.description
      || parsed.data.expected_structure_revision !== existing.structure_revision) {
      throw conflict("Storage changed since this editor was opened");
    }
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
    const result = await this.store.updateStorage({
      id,
      patch,
      expected: {
        name: existing.name,
        description: existing.description,
        structureRevision: existing.structure_revision,
      },
      audit,
    });
    if (result.status === "not_found") throw notFound("Storage not found");
    if (result.status === "stale") throw conflict("Storage changed since this editor was opened");
    return this.changed(result.value, storageId, context.now);
  }

  async deleteStorage(context: RequestContext, storageId: string, body: unknown): Promise<{ ok: true }> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = deleteStorageSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid storage deletion payload", parsed.error.flatten());
    const id = requiredId(storageId, "storage");
    const existing = (await this.store.getTree()).data.find((storage) => storage.id === id);
    if (!existing) throw notFound("Storage not found");
    if (parsed.data.expected_structure_revision !== existing.structure_revision) {
      throw conflict("Storage structure changed since confirmation opened");
    }
    const audit = createAuditEvent(context, {
      subjectType: "storage",
      subjectId: id,
      subjectLabel: existing.name,
      action: "delete",
      context: [],
    });
    const result = await this.store.deleteStorage({
      id,
      expectedStructureRevision: existing.structure_revision,
      audit,
    });
    if (result === "not_found") throw notFound("Storage not found");
    if (result === "stale") throw conflict("Storage structure changed since confirmation opened");
    if (result !== "deleted") throw conflict("Storage must be empty before deletion");
    return this.changed({ ok: true }, id, context.now);
  }

  async createCategory(
    context: RequestContext,
    storageId: string,
    body: unknown,
  ): Promise<StorageCategoryMutationResponse> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = createStorageCategorySchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid category payload", parsed.error.flatten());
    const targetStorageId = requiredId(storageId, "storage");
    const storage = (await this.store.getTree()).data.find(({ id }) => id === targetStorageId);
    if (!storage) throw notFound("Storage not found");
    if (parsed.data.expected_structure_revision !== storage.structure_revision) {
      throw conflict("Storage structure changed since this editor was opened");
    }
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
      expectedStructureRevision: storage.structure_revision,
      audit,
    });
    if (placement.status !== "created") {
      if (placement.status === "limit_reached") throw invalid("Storage category limit reached");
      if (placement.status === "storage_missing") throw notFound("Storage not found");
      throw conflict("Storage structure changed since this editor was opened");
    }
    return this.changed({
      category: placement.value,
      structure_revision: placement.structureRevision,
    }, storageId, context.now);
  }

  async updateCategory(
    context: RequestContext,
    storageId: string,
    categoryId: string,
    body: unknown,
  ): Promise<StorageCategoryMutationResponse> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = updateStorageCategorySchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid category payload", parsed.error.flatten());
    const targetStorageId = requiredId(storageId, "storage");
    const id = requiredId(categoryId, "category");
    const storage = (await this.store.getTree()).data.find((item) => item.id === targetStorageId);
    const existing = storage?.categories.find((category) => category.id === id);
    if (!storage || !existing) throw notFound("Category not found");
    if (parsed.data.expected_name !== existing.name
      || parsed.data.expected_structure_revision !== storage.structure_revision) {
      throw conflict("Storage category changed since this editor was opened");
    }
    if (parsed.data.name === existing.name) {
      return { category: existing, structure_revision: storage.structure_revision };
    }
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
    const result = await this.store.updateCategory({
      storageId: targetStorageId,
      categoryId,
      name: parsed.data.name,
      expectedName: existing.name,
      expectedStructureRevision: storage.structure_revision,
      audit,
    });
    if (result.status !== "updated") {
      if (result.status === "not_found") throw notFound("Category not found");
      throw conflict("Storage category changed since this editor was opened");
    }
    return this.changed({
      category: result.value.category,
      structure_revision: result.value.structureRevision,
    }, storageId, context.now);
  }

  async deleteCategory(
    context: RequestContext,
    storageId: string,
    categoryId: string,
    body: unknown,
  ): Promise<StorageCategoryDeleteResponse> {
    context.authorization.require(STRUCTURE_PERMISSION);
    const parsed = deleteStorageCategorySchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid category deletion payload", parsed.error.flatten());
    const id = requiredId(categoryId, "category");
    const targetStorageId = requiredId(storageId, "storage");
    const storage = (await this.store.getTree()).data.find((item) => item.id === targetStorageId);
    const existing = storage?.categories.find((category) => category.id === id);
    if (!storage || !existing) throw notFound("Category not found");
    if (parsed.data.expected_structure_revision !== storage.structure_revision) {
      throw conflict("Storage structure changed since confirmation opened");
    }
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
    const result = await this.store.deleteCategory({
      storageId: targetStorageId,
      categoryId: id,
      expectedStructureRevision: storage.structure_revision,
      audit,
    });
    if (result.status === "not_found") throw notFound("Category not found");
    if (result.status === "stale") throw conflict("Storage structure changed since confirmation opened");
    if (result.status !== "deleted") throw conflict("Category must be empty before deletion");
    return this.changed({ ok: true, structure_revision: result.structureRevision }, storageId, context.now);
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
      rarity: parsed.data.rarity,
      unit: parsed.data.unit ?? null,
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
      }, {
        field: "rarity",
        value: { type: "text", value: item.rarity },
      }, {
        field: "unit",
        value: item.unit === null ? { type: "null", value: null } : { type: "text", value: item.unit },
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
    if (parsed.data.expected_updated_at !== current.updated_at) {
      throw conflict("Storage item changed since this editor was opened");
    }
    let tree: { data: Storage[] } | null = null;
    if (parsed.data.category_id !== undefined) {
      assertPlacement(await this.store.validateItemPlacement(current.storage_id, parsed.data.category_id));
      tree = await this.store.getTree();
    }
    const patch: {
      categoryId?: string | null;
      name?: string;
      description?: string | null;
      rarity?: StorageRarity;
      unit?: string | null;
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
    if (parsed.data.rarity !== undefined && parsed.data.rarity !== current.rarity) {
      patch.rarity = parsed.data.rarity;
      changes.push({
        field: "rarity",
        before: { type: "text", value: current.rarity },
        after: { type: "text", value: parsed.data.rarity },
      });
    }
    if (parsed.data.unit !== undefined && (parsed.data.unit ?? null) !== current.unit) {
      patch.unit = parsed.data.unit ?? null;
      changes.push({
        field: "unit",
        before: current.unit === null ? { type: "null", value: null } : { type: "text", value: current.unit },
        after: parsed.data.unit === null
          ? { type: "null", value: null }
          : { type: "text", value: parsed.data.unit },
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
    const imageIds = [...((await this.media.listItemMediaIds([id])).get(id) ?? [])];
    let result: StorageUpdateResult<StorageItemRecord>;
    try {
      result = await this.store.updateItem({
        id,
        patch,
        expectedUpdatedAt: current.updated_at,
        updatedAt: monotonicTimestamp(context.now, current.updated_at),
        audit,
      });
    } catch (error) {
      throw placementRace(error);
    }
    if (result.status === "not_found") throw notFound("Item not found");
    if (result.status === "stale") throw conflict("Storage item changed since this editor was opened");
    return this.changed({
      ...result.value,
      images: imageIds.map((media_id) => ({ media_id })),
    }, id, context.now);
  }

  async deleteItem(context: RequestContext, itemId: string, body: unknown): Promise<{ ok: true }> {
    context.authorization.require(ITEMS_PERMISSION);
    const parsed = deleteStorageItemSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid item deletion payload", parsed.error.flatten());
    const id = requiredId(itemId, "item");
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    if (parsed.data.expected_updated_at !== item.updated_at) {
      throw conflict("Storage item changed since confirmation opened");
    }
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
    const result = await this.store.deleteItem({
      itemId: id,
      expectedUpdatedAt: item.updated_at,
      audit,
    });
    if (result === "not_found") throw notFound("Item not found");
    if (result === "stale") throw conflict("Storage item changed since confirmation opened");
    if (result !== "deleted") throw conflict("Storage items with transaction history cannot be deleted");
    return this.changed({ ok: true }, id, context.now);
  }

  async uploadImages(
    context: RequestContext,
    itemId: string,
    uploads: readonly ImageUpload[],
    body: unknown,
  ): Promise<StorageItemImageUploadResponse> {
    context.authorization.require(ITEMS_PERMISSION);
    const parsed = storageItemImageMutationSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid image upload payload", parsed.error.flatten());
    const id = requiredId(itemId, "item");
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    if (parsed.data.expected_updated_at !== item.updated_at) {
      throw conflict("Storage item changed since this editor was opened");
    }
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: item.name,
      action: "upload_images",
      context: [{ field: "upload_count", value: { type: "number", value: uploads.length } }],
    });
    const result = await this.media.attachItemImages({
      context,
      itemId: id,
      uploads,
      expectedUpdatedAt: item.updated_at,
      updatedAt: monotonicTimestamp(context.now, item.updated_at),
      audit,
    });
    if (result.status === "not_found") throw notFound("Item not found");
    if (result.status === "stale") throw conflict("Storage item changed since this editor was opened");
    if (result.status !== "updated") throw new AppError({
      code: "SERVER_ERROR",
      status: 500,
      message: "Storage image upload did not update the item revision",
    });
    return this.changed({
      data: result.mediaIds.map((mediaId) => ({ media_id: mediaId })),
      updated_at: result.updatedAt,
    }, id, context.now);
  }

  async deleteImage(
    context: RequestContext,
    itemId: string,
    mediaId: string,
    body: unknown,
  ): Promise<StorageItemImageDeleteResponse> {
    context.authorization.require(ITEMS_PERMISSION);
    const parsed = storageItemImageMutationSchema.safeParse(body);
    if (!parsed.success) throw invalid("Invalid image deletion payload", parsed.error.flatten());
    const id = requiredId(itemId, "item");
    const media = requiredId(mediaId, "media");
    const item = await this.store.getItem(id);
    if (!item) throw notFound("Item not found");
    if (parsed.data.expected_updated_at !== item.updated_at) {
      throw conflict("Storage item changed since this editor was opened");
    }
    const audit = createAuditEvent(context, {
      subjectType: "storage_item",
      subjectId: id,
      subjectLabel: item.name,
      action: "delete_images",
      context: [{ field: "media_count", value: { type: "number", value: 1 } }],
    });
    const result = await this.media.detachItemImage({
      context,
      itemId: id,
      mediaId: media,
      expectedUpdatedAt: item.updated_at,
      updatedAt: monotonicTimestamp(context.now, item.updated_at),
      audit,
    });
    if (result.status === "not_found") throw notFound("Item not found");
    if (result.status === "image_not_found") throw notFound("Image not found");
    if (result.status === "stale") throw conflict("Storage item changed since this editor was opened");
    if (result.status !== "updated") throw new AppError({
      code: "SERVER_ERROR",
      status: 500,
      message: "Storage image deletion did not update the item revision",
    });
    return this.changed({ ok: true, updated_at: result.updatedAt }, id, context.now);
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
      ...(parsed.data.storage_id ? { storageId: parsed.data.storage_id } : {}),
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
      idempotencyKey: payload.idempotency_key,
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
      idempotencyKey: string;
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
    const targetQuantity = input.type === "adjust" ? input.targetQuantity ?? null : null;
    if (input.type === "adjust" && targetQuantity === null) {
      throw invalid("target_quantity required for adjust");
    }
    const normalizedRequest: NormalizedStockRequest = {
      type: input.type,
      entries: input.entries,
      recipientUserId,
      note: input.note,
      targetQuantity,
    };
    const requestFingerprint = await fingerprintStockRequest(normalizedRequest);

    const existing = await this.store.findBatch(actor.userId, input.idempotencyKey);
    if (existing) return replay(existing, requestFingerprint);

    const snapshot = await this.store.getSubmissionSnapshot(actor.userId, recipientUserId, input.entries);
    if (!snapshot.actorExists) throw new AppError({ code: "UNAUTHORIZED", status: 401, message: "Authentication required" });
    if (recipientUserId !== null && !snapshot.recipientExists) throw notFound("Recipient not found");
    if (recipientUserId !== null && snapshot.recipientUsername === null) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Recipient display name is unavailable" });
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
        ? (normalizedRequest.targetQuantity! - item.quantity)
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
        recipient_display_name: snapshot.recipientUsername,
        note: input.note,
        actor_id: actor.userId,
        actor_display_name: snapshot.actorUsername,
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
      requestFingerprint,
      accessMode: manager ? "stock_admin" : "member_self",
      request: normalizedRequest,
      createdAt,
      transactions,
      audit,
    };
    try {
      const committedTransactions = await this.store.commitStock(commit);
      return this.changed({ data: [...committedTransactions], replayed: false }, batchId, context.now);
    } catch (error) {
      if (error instanceof StorageStoreError) {
        if (error.code === "idempotency_conflict") {
          const existing = await this.store.findBatch(actor.userId, input.idempotencyKey);
          if (existing) return replay(existing, requestFingerprint);
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
  requestFingerprint: string,
): StorageBatchTransactionResult {
  if (stored.requestFingerprint !== requestFingerprint) {
    throw conflict("Idempotency key was already used with a different request");
  }
  return { data: [...stored.transactions], replayed: true };
}

async function fingerprintStockRequest(request: NormalizedStockRequest): Promise<string> {
  const canonical = JSON.stringify({
    type: request.type,
    entries: request.entries.map(({ itemId, quantity }) => [itemId, quantity]),
    recipient_user_id: request.recipientUserId,
    note: request.note,
    target_quantity: request.targetQuantity,
  });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function monotonicTimestamp(now: string, previous: string): string {
  const nowMs = Date.parse(now);
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs)) return now;
  return new Date(Math.max(nowMs, previousMs + 1)).toISOString();
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
