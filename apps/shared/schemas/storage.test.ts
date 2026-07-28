import { describe, expect, it } from "vitest";
import { createStorageBatchTransactionSchema, STORAGE_STOCK_FILTERS, storageBatchTransactionResultSchema, storageItemsListQuerySchema } from "./storage";

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
});
