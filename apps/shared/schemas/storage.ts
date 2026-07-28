import { z } from "zod";
import { LIMITS } from "../config/limits";

const L = LIMITS.content;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

// --- Read schemas (loose: no trim/min on strings) ---

export const storageCategorySchema = z.object({ id: z.string(), name: z.string() });

export const storageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  categories: z.array(storageCategorySchema),
});

export const storageItemSchema = z.object({
  id: z.string(),
  storage_id: z.string(),
  category_id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number().int().min(0),
  allow_member_deposit: z.boolean(),
  allow_member_withdraw: z.boolean(),
  images: z.array(z.object({ id: z.string(), r2_key: z.string() })), // upload order = created_at
  created_at: z.string(),
  updated_at: z.string(),
});

export const STORAGE_TRANSACTION_TYPES = ["intake", "distribute", "adjust"] as const;
export const STORAGE_STOCK_FILTERS = ["all", "available", "empty", "deposit", "withdraw"] as const;
export const storageStockFilterSchema = z.enum(STORAGE_STOCK_FILTERS);

export const storageItemsListQuerySchema = z.object({
  storage_id: z.string().trim().min(1).optional(),
  category_id: z.string().trim().min(1).optional(),
  search: z.string().trim().max(L.storageItemName.max).optional(),
  stock: storageStockFilterSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(LIMITS.pagination.storage),
  cursor: z.string().min(1).max(512).optional(),
});

export const storageTransactionSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  item_name: z.string().nullable(),
  type: z.enum(STORAGE_TRANSACTION_TYPES),
  quantity_delta: z.number().int(),
  recipient_user_id: z.string().nullable(),
  recipient_username: z.string().nullable(),
  note: z.string().max(L.storageNote.max).nullable(),
  actor_id: z.string(),
  actor_username: z.string().nullable(),
  created_at: z.string(),
});

// --- Write schemas (strict: trimmed, length-limited) ---

export const createStorageSchema = z.object({
  name: trimmed(L.storageName.max),
  description: z.string().trim().max(L.storageDescription.max).optional().nullable(),
});

export const createStorageCategorySchema = z.object({
  name: trimmed(L.storageCategoryName.max),
});

// Base WITHOUT defaults so updateStorageItemSchema.partial() emits only the keys sent
// (defaults would survive .partial() and silently reset flags on unrelated updates).
const storageItemWriteBaseSchema = z.object({
  category_id: z.string().optional().nullable(),
  name: trimmed(L.storageItemName.max),
  description: z.string().trim().max(L.storageItemDescription.max).optional().nullable(),
  allow_member_deposit: z.boolean(),
  allow_member_withdraw: z.boolean(),
});

export const createStorageItemSchema = storageItemWriteBaseSchema.extend({
  storage_id: z.string(),
  allow_member_deposit: z.boolean().default(false),
  allow_member_withdraw: z.boolean().default(false),
});

export const updateStorageItemSchema = storageItemWriteBaseSchema.partial();

const txQuantity = z.number().int().min(1).max(L.storageTransactionQuantity.max);
const txTargetQuantity = z.number().int().min(0).max(L.storageTransactionQuantity.max);

export const createStorageTransactionSchema = z
  .object({
    type: z.enum(STORAGE_TRANSACTION_TYPES),
    quantity: txQuantity.optional(), // intake/distribute only; always positive on the wire
    target_quantity: txTargetQuantity.optional(), // adjust only; service derives the delta
    recipient_user_id: z.string().optional().nullable(),
    note: z.string().trim().max(L.storageNote.max).optional().nullable(),
  })
  .refine((v) => v.type === "adjust" || v.quantity !== undefined, {
    message: "quantity required for intake and distribute",
  })
  .refine((v) => v.type !== "distribute" || Boolean(v.recipient_user_id), {
    message: "recipient_user_id required for distribute",
  })
  .refine((v) => v.type !== "adjust" || v.target_quantity !== undefined, {
    message: "target_quantity required for adjust",
  });

const batchIdempotencyKey = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,63}$/, "Invalid idempotency key");

export const createStorageBatchTransactionSchema = z
  .object({
    idempotency_key: batchIdempotencyKey,
    type: z.enum(["intake", "distribute"]),
    entries: z.array(z.object({
      item_id: z.string().trim().min(1).max(128),
      quantity: txQuantity,
    })).min(1).max(20),
    recipient_user_id: z.string().trim().min(1).max(128).optional().nullable(),
    note: z.string().trim().max(L.storageNote.max).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const itemIds = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      if (itemIds.has(entry.item_id)) {
        ctx.addIssue({ code: "custom", path: ["entries", index, "item_id"], message: "item_id entries must be unique" });
      }
      itemIds.add(entry.item_id);
    }
  });

export const storageBatchTransactionResultSchema = z.object({
  data: z.array(storageTransactionSchema),
  replayed: z.boolean(),
});

export type Storage = z.infer<typeof storageSchema>;
export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type StorageItem = z.infer<typeof storageItemSchema>;
export type StorageTransaction = z.infer<typeof storageTransactionSchema>;
export type StorageStockFilter = z.infer<typeof storageStockFilterSchema>;
export type StorageItemsListQuery = z.infer<typeof storageItemsListQuerySchema>;
export type CreateStoragePayload = z.input<typeof createStorageSchema>;
export type CreateStorageCategoryPayload = z.input<typeof createStorageCategorySchema>;
export type CreateStorageItemPayload = z.input<typeof createStorageItemSchema>;
export type UpdateStorageItemPayload = z.input<typeof updateStorageItemSchema>;
export type CreateStorageTransactionPayload = z.input<typeof createStorageTransactionSchema>;
export type CreateStorageBatchTransactionPayload = z.input<typeof createStorageBatchTransactionSchema>;
export type StorageBatchTransactionResult = z.infer<typeof storageBatchTransactionResultSchema>;
