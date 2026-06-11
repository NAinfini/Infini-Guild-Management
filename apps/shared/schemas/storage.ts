import { z } from "zod";
import { LIMITS } from "../config/limits";

const L = LIMITS.content;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const storageSchema = z.object({
  id: z.string(),
  name: trimmed(L.storageName.max),
  description: z.string().trim().max(L.storageDescription.max).nullable(),
  created_at: z.string(),
  categories: z.array(z.object({ id: z.string(), name: trimmed(L.storageName.max) })),
});

export const storageItemSchema = z.object({
  id: z.string(),
  storage_id: z.string(),
  category_id: z.string().nullable(),
  name: trimmed(L.storageItemName.max),
  description: z.string().trim().max(L.storageItemDescription.max).nullable(),
  quantity: z.number().int().min(0),
  member_deposit: z.boolean(),
  member_withdraw: z.boolean(),
  images: z.array(z.object({ id: z.string(), r2_key: z.string() })), // upload order = created_at
  created_at: z.string(),
  updated_at: z.string(),
});

export const STORAGE_TRANSACTION_TYPES = ["intake", "distribute", "adjust"] as const;

export const storageTransactionSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  item_name: z.string().nullable(),
  type: z.enum(STORAGE_TRANSACTION_TYPES),
  quantity_delta: z.number().int(),
  recipient_user_id: z.string().nullable(),
  recipient_username: z.string().nullable(),
  note: z.string().nullable(),
  actor_id: z.string(),
  actor_username: z.string().nullable(),
  created_at: z.string(),
});

export const createStorageSchema = z.object({
  name: trimmed(L.storageName.max),
  description: z.string().trim().max(L.storageDescription.max).optional().nullable(),
});

export const createStorageCategorySchema = z.object({
  name: trimmed(L.storageName.max),
});

export const createStorageItemSchema = z.object({
  storage_id: z.string(),
  category_id: z.string().optional().nullable(),
  name: trimmed(L.storageItemName.max),
  description: z.string().trim().max(L.storageItemDescription.max).optional().nullable(),
  member_deposit: z.boolean().optional().default(false),
  member_withdraw: z.boolean().optional().default(false),
});

export const updateStorageItemSchema = createStorageItemSchema.omit({ storage_id: true }).partial();

const txQuantity = z.number().int().min(1).max(L.storageTransactionQuantity.max);

export const createStorageTransactionSchema = z
  .object({
    type: z.enum(STORAGE_TRANSACTION_TYPES),
    quantity: txQuantity, // always positive on the wire; service derives the sign
    direction: z.enum(["in", "out"]).optional(), // REQUIRED for adjust; ignored otherwise
    recipient_user_id: z.string().optional().nullable(),
    note: z.string().trim().max(L.storageNote.max).optional().nullable(),
  })
  .refine((v) => v.type !== "distribute" || Boolean(v.recipient_user_id), {
    message: "recipient_user_id required for distribute",
  })
  .refine((v) => v.type !== "adjust" || v.direction !== undefined, {
    message: "direction required for adjust",
  });

export const intakeBatchSchema = z.object({
  entries: z.array(z.object({ item_id: z.string(), quantity: txQuantity })).min(1).max(50),
  note: z.string().trim().max(L.storageNote.max).optional().nullable(),
});

export type Storage = z.infer<typeof storageSchema>;
export type StorageItem = z.infer<typeof storageItemSchema>;
export type StorageTransaction = z.infer<typeof storageTransactionSchema>;
export type CreateStorageTransactionPayload = z.infer<typeof createStorageTransactionSchema>;
export type IntakeBatchPayload = z.infer<typeof intakeBatchSchema>;
