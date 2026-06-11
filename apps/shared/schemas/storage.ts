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
export const STORAGE_ADJUST_DIRECTIONS = ["in", "out"] as const;

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

export const createStorageTransactionSchema = z
  .object({
    type: z.enum(STORAGE_TRANSACTION_TYPES),
    quantity: txQuantity, // always positive on the wire; service derives the sign
    direction: z.enum(STORAGE_ADJUST_DIRECTIONS).optional(), // REQUIRED for adjust; ignored otherwise
    recipient_user_id: z.string().optional().nullable(),
    note: z.string().trim().max(L.storageNote.max).optional().nullable(),
  })
  .refine((v) => v.type !== "distribute" || Boolean(v.recipient_user_id), {
    message: "recipient_user_id required for distribute",
  })
  .refine((v) => v.type !== "adjust" || v.direction !== undefined, {
    message: "direction required for adjust",
  });

export const storageIntakeBatchSchema = z.object({
  entries: z.array(z.object({ item_id: z.string(), quantity: txQuantity })).min(1).max(L.storageIntakeBatch.max),
  note: z.string().trim().max(L.storageNote.max).optional().nullable(),
});

export type Storage = z.infer<typeof storageSchema>;
export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type StorageItem = z.infer<typeof storageItemSchema>;
export type StorageTransaction = z.infer<typeof storageTransactionSchema>;
export type CreateStoragePayload = z.input<typeof createStorageSchema>;
export type CreateStorageCategoryPayload = z.input<typeof createStorageCategorySchema>;
export type CreateStorageItemPayload = z.input<typeof createStorageItemSchema>;
export type UpdateStorageItemPayload = z.input<typeof updateStorageItemSchema>;
export type CreateStorageTransactionPayload = z.input<typeof createStorageTransactionSchema>;
export type StorageIntakeBatchPayload = z.input<typeof storageIntakeBatchSchema>;
