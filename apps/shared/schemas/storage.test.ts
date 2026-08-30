import { describe, expect, it } from "vitest";
import {
  createStorageBatchTransactionSchema,
  createStorageTransactionSchema,
  deleteStorageCategorySchema,
  deleteStorageItemSchema,
  deleteStorageSchema,
  STORAGE_STOCK_FILTERS,
  storageItemImageMutationSchema,
  storageBatchTransactionResultSchema,
  storageItemSchema,
  storageItemsCursorResponseSchema,
  storageItemsListQuerySchema,
  storageTransactionSchema,
  storageTransactionsListQuerySchema,
  storageTransactionsPageResponseSchema,
  storageTreeResponseSchema,
  updateStorageCategorySchema,
  updateStorageItemSchema,
  updateStorageSchema,
} from "./storage";

describe("storage editor revision contracts", () => {
  it("requires the original structure values for storage and category compare-and-swap", () => {
    expect(updateStorageSchema.safeParse({
      name: "Updated",
      expected_name: "Original",
      expected_description: null,
      expected_structure_revision: 3,
    }).success).toBe(true);
    expect(updateStorageSchema.safeParse({ name: "Updated" }).success).toBe(false);
    expect(updateStorageCategorySchema.safeParse({
      name: "Updated",
      expected_name: "Original",
      expected_structure_revision: 3,
    }).success).toBe(true);
    expect(updateStorageCategorySchema.safeParse({ name: "Updated" }).success).toBe(false);
  });

  it("requires the structural revision captured when a destructive confirmation opens", () => {
    expect(deleteStorageSchema.safeParse({ expected_structure_revision: 3 }).success).toBe(true);
    expect(deleteStorageCategorySchema.safeParse({ expected_structure_revision: 3 }).success).toBe(true);
    expect(deleteStorageSchema.safeParse({}).success).toBe(false);
    expect(deleteStorageCategorySchema.safeParse({ expected_structure_revision: -1 }).success).toBe(false);
  });

  it("requires an item revision and at least one actual field change", () => {
    expect(updateStorageItemSchema.safeParse({
      rarity: "rare",
      expected_updated_at: "2026-08-09T00:00:00.000Z",
    }).success).toBe(true);
    expect(updateStorageItemSchema.safeParse({ rarity: "rare" }).success).toBe(false);
    expect(updateStorageItemSchema.safeParse({
      expected_updated_at: "2026-08-09T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("requires the item aggregate revision for image and item deletion", () => {
    const expected_updated_at = "2026-08-09T00:00:00.000Z";
    expect(deleteStorageItemSchema.safeParse({ expected_updated_at }).success).toBe(true);
    expect(storageItemImageMutationSchema.safeParse({ expected_updated_at }).success).toBe(true);
    expect(deleteStorageItemSchema.safeParse({}).success).toBe(false);
    expect(storageItemImageMutationSchema.safeParse({ expected_updated_at: "" }).success).toBe(false);
  });
});

describe("createStorageBatchTransactionSchema", () => {
  const valid = {
    idempotency_key: "batch-key-123456",
    type: "intake",
    entries: [{ item_id: "item-1", quantity: 1 }],
  };

  it("accepts a safe key and up to twenty unique item entries", () => {
    expect(createStorageBatchTransactionSchema.safeParse({
      ...valid,
      entries: Array.from({ length: 20 }, (_, index) => ({ item_id: `item-${index}`, quantity: index + 1 })),
    }).success).toBe(true);
  });

  it("accepts finite decimal quantities and rejects non-positive or non-finite quantities", () => {
    expect(createStorageBatchTransactionSchema.safeParse({
      ...valid,
      entries: [{ item_id: "item-1", quantity: 0.25 }],
    }).success).toBe(true);
    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createStorageBatchTransactionSchema.safeParse({
        ...valid,
        entries: [{ item_id: "item-1", quantity }],
      }).success).toBe(false);
    }
  });

  it("rejects unsafe keys and duplicate items", () => {
    expect(createStorageBatchTransactionSchema.safeParse({ ...valid, idempotency_key: "too short" }).success).toBe(false);
    expect(createStorageBatchTransactionSchema.safeParse({
      ...valid,
      entries: [{ item_id: "item-1", quantity: 1 }, { item_id: "item-1", quantity: 2 }],
    }).success).toBe(false);
  });

  it("rejects unsupported directions, oversized batches, and unbounded identifiers", () => {
    expect(createStorageBatchTransactionSchema.safeParse({ ...valid, type: "adjust" }).success).toBe(false);
    expect(createStorageBatchTransactionSchema.safeParse({
      ...valid,
      entries: Array.from({ length: 21 }, (_, index) => ({ item_id: `item-${index}`, quantity: 1 })),
    }).success).toBe(false);
    expect(createStorageBatchTransactionSchema.safeParse({
      ...valid,
      entries: [{ item_id: "x".repeat(129), quantity: 1 }],
    }).success).toBe(false);
  });
});

describe("storageBatchTransactionResultSchema", () => {
  it("requires a transaction list and replay marker", () => {
    expect(storageBatchTransactionResultSchema.safeParse({ data: [], replayed: false }).success).toBe(true);
    expect(storageBatchTransactionResultSchema.safeParse({ data: [], replayed: "false" }).success).toBe(false);
  });
});

describe("storageItemsListQuerySchema", () => {
  it("accepts every supported stock filter and the storage page defaults", () => {
    expect(STORAGE_STOCK_FILTERS).toEqual(["all", "available", "empty", "deposit", "withdraw"]);
    expect(storageItemsListQuerySchema.parse({ stock: "available" })).toMatchObject({
      stock: "available",
      limit: 24,
    });
  });

  it("rejects invalid stock filters and limits outside the supported range", () => {
    expect(storageItemsListQuerySchema.safeParse({ stock: "missing" }).success).toBe(false);
    expect(storageItemsListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(storageItemsListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("validates the UTF-8 size after lowercase normalization and LIKE escaping", () => {
    expect(storageItemsListQuerySchema.safeParse({ search: "İ".repeat(16) }).success).toBe(true);
    expect(storageItemsListQuerySchema.safeParse({ search: "İ".repeat(17) }).success).toBe(false);
  });
});

describe("storage transaction contracts", () => {
  it("keeps the Portal single-transaction wire while allowing finite decimal stock", () => {
    expect(createStorageTransactionSchema.parse({
      idempotency_key: "single-key-123456",
      type: "intake",
      quantity: 1.5,
      recipient_user_id: "user-1",
      note: null,
    })).toEqual({
      idempotency_key: "single-key-123456",
      type: "intake",
      quantity: 1.5,
      recipient_user_id: "user-1",
      note: null,
    });
    expect(createStorageTransactionSchema.safeParse({ type: "intake", quantity: 1 }).success).toBe(false);
    expect(createStorageTransactionSchema.safeParse({
      idempotency_key: "too short",
      type: "intake",
      quantity: 1,
    }).success).toBe(false);
    expect(createStorageTransactionSchema.safeParse({ type: "intake", quantity: Number.NaN }).success).toBe(false);
    expect(createStorageTransactionSchema.safeParse({ type: "adjust", target_quantity: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("requires non-zero finite ledger deltas", () => {
    const base = {
      id: "tx-1",
      item_id: "item-1",
      item_name: "Potion",
      type: "intake" as const,
      recipient_user_id: "user-1",
      recipient_display_name: "member",
      note: null,
      actor_id: "user-1",
      actor_display_name: "member",
      created_at: "2026-08-09T00:00:00.000Z",
    };
    expect(storageTransactionSchema.safeParse({ ...base, quantity_delta: 0.5 }).success).toBe(true);
    expect(storageTransactionSchema.safeParse({ ...base, quantity_delta: 0 }).success).toBe(false);
    expect(storageTransactionSchema.safeParse({ ...base, quantity_delta: Number.NEGATIVE_INFINITY }).success).toBe(false);
  });

  it("bounds the Portal page query and preserves its defaults", () => {
    expect(storageTransactionsListQuerySchema.parse({})).toEqual({ page: 1, limit: 50 });
    expect(storageTransactionsListQuerySchema.parse({
      item_id: "item-1",
      recipient_user_id: "me",
      page: "2",
      limit: "25",
    })).toEqual({ item_id: "item-1", recipient_user_id: "me", page: 2, limit: 25 });
    expect(storageTransactionsListQuerySchema.safeParse({ page: "10001" }).success).toBe(false);
  });
});

describe("storage Portal response wire", () => {
  const item = storageItemSchema.parse({
    id: "item-1",
    storage_id: "storage-1",
    category_id: null,
    name: "Potion",
    description: null,
    rarity: "common",
    unit: null,
    quantity: 1.5,
    allow_member_deposit: true,
    allow_member_withdraw: false,
    images: [{ media_id: "m".repeat(21) }],
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
  });

  it("preserves tree, cursor, and page response envelopes", () => {
    expect(storageTreeResponseSchema.safeParse({ data: [{
      id: "storage-1",
      name: "Guild Vault",
      description: null,
      created_at: "2026-08-09T00:00:00.000Z",
      structure_revision: 0,
      categories: [],
    }] }).success).toBe(true);
    expect(storageItemsCursorResponseSchema.safeParse({ data: [item], next_cursor: null }).success).toBe(true);
    expect(storageTransactionsPageResponseSchema.safeParse({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 1,
    }).success).toBe(true);
  });
});
