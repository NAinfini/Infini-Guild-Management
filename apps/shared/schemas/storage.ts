import { z } from "zod";
import { LIMITS, MAX_OFFSET_PAGE } from "../config/limits";
import { mediaIdSchema } from "./media";
import { isPortableLowercaseLikeSearch } from "../utils/portable-search";
import { STORAGE_RARITIES } from "../constants/storage";

const L = LIMITS.content;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const structureRevisionSchema = z.number().int().min(0);
const itemRevisionSchema = z.string().trim().min(1).max(64);

// --- Read schemas (loose: no trim/min on strings) ---

export const storageCategorySchema = z.object({ id: z.string(), name: z.string() });

export const storageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  structure_revision: structureRevisionSchema,
  categories: z.array(storageCategorySchema),
});

export const storageItemSchema = z.object({
  id: z.string(),
  storage_id: z.string(),
  category_id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  rarity: z.enum(STORAGE_RARITIES),
  unit: z.string().nullable(),
  quantity: z.number().finite().min(0),
  allow_member_deposit: z.boolean(),
  allow_member_withdraw: z.boolean(),
  images: z.array(z.object({ media_id: mediaIdSchema })),
  created_at: z.string(),
  updated_at: z.string(),
});

export const STORAGE_TRANSACTION_TYPES = ["intake", "distribute", "adjust"] as const;
export const STORAGE_STOCK_FILTERS = ["all", "available", "empty", "deposit", "withdraw"] as const;
export const storageStockFilterSchema = z.enum(STORAGE_STOCK_FILTERS);

export const storageItemsListQuerySchema = z.object({
  storage_id: z.string().trim().min(1).optional(),
  category_id: z.string().trim().min(1).optional(),
  search: z.string().trim().max(L.storageItemName.max)
    .refine(isPortableLowercaseLikeSearch, "Search exceeds the portable 50-byte pattern limit")
    .optional(),
  stock: storageStockFilterSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(LIMITS.pagination.storage),
  cursor: z.string().min(1).max(512).optional(),
});

export const storageTransactionSchema = z.object({
  id: z.string(),
  item_id: z.string(),
  item_name: z.string().nullable(),
  type: z.enum(STORAGE_TRANSACTION_TYPES),
  quantity_delta: z.number().finite().refine((value) => value !== 0, {
    message: "quantity_delta must be non-zero",
  }),
  recipient_user_id: z.string().nullable(),
  recipient_display_name: z.string().nullable(),
  note: z.string().max(L.storageNote.max).nullable(),
  actor_id: z.string(),
  actor_display_name: z.string().nullable(),
  created_at: z.string(),
});

// --- Write schemas (strict: trimmed, length-limited) ---

export const createStorageSchema = z.object({
  name: trimmed(L.storageName.max),
  description: z.string().trim().max(L.storageDescription.max).optional().nullable(),
});

export const createStorageCategorySchema = z.object({
  name: trimmed(L.storageCategoryName.max),
  expected_structure_revision: structureRevisionSchema,
});

export const updateStorageSchema = createStorageSchema.partial().extend({
  expected_name: trimmed(L.storageName.max),
  expected_description: z.string().max(L.storageDescription.max).nullable(),
  expected_structure_revision: structureRevisionSchema,
}).refine(
  ({ name, description }) => name !== undefined || description !== undefined,
  { message: "At least one storage field must be updated" },
);

export const updateStorageCategorySchema = createStorageCategorySchema.extend({
  expected_name: trimmed(L.storageCategoryName.max),
});

export const deleteStorageSchema = z.object({
  expected_structure_revision: structureRevisionSchema,
});

export const deleteStorageCategorySchema = z.object({
  expected_structure_revision: structureRevisionSchema,
});

// Base WITHOUT defaults so updateStorageItemSchema.partial() emits only the keys sent
// (defaults would survive .partial() and silently reset flags on unrelated updates).
const storageItemWriteBaseSchema = z.object({
  category_id: z.string().optional().nullable(),
  name: trimmed(L.storageItemName.max),
  description: z.string().trim().max(L.storageItemDescription.max).optional().nullable(),
  rarity: z.enum(STORAGE_RARITIES),
  unit: z.string().trim().min(1).max(L.storageItemUnit.max).optional().nullable(),
  allow_member_deposit: z.boolean(),
  allow_member_withdraw: z.boolean(),
});

export const createStorageItemSchema = storageItemWriteBaseSchema.extend({
  storage_id: z.string(),
  rarity: z.enum(STORAGE_RARITIES).default("common"),
  allow_member_deposit: z.boolean().default(false),
  allow_member_withdraw: z.boolean().default(false),
});

export const updateStorageItemSchema = storageItemWriteBaseSchema.partial().extend({
  expected_updated_at: itemRevisionSchema,
}).refine(
  ({ expected_updated_at: _expectedUpdatedAt, ...patch }) => Object.values(patch).some((value) => value !== undefined),
  { message: "At least one item field must be updated" },
);

export const deleteStorageItemSchema = z.object({
  expected_updated_at: itemRevisionSchema,
});

/** The multipart image endpoint receives this same payload as a text form field. */
export const storageItemImageMutationSchema = z.object({
  expected_updated_at: itemRevisionSchema,
});

const txQuantity = z.number().finite().positive().max(L.storageTransactionQuantity.max);
const txTargetQuantity = z.number().finite().min(0).max(L.storageTransactionQuantity.max);
const stockIdempotencyKey = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,63}$/, "Invalid idempotency key");

export const createStorageTransactionSchema = z
  .object({
    idempotency_key: stockIdempotencyKey,
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

export const createStorageBatchTransactionSchema = z
  .object({
    idempotency_key: stockIdempotencyKey,
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

const storageImageReferenceSchema = z.object({ media_id: mediaIdSchema });

export const storageCategoryMutationResponseSchema = z.object({
  category: storageCategorySchema,
  structure_revision: structureRevisionSchema,
});

export const storageCategoryDeleteResponseSchema = z.object({
  ok: z.literal(true),
  structure_revision: structureRevisionSchema,
});

export const storageItemImageUploadResponseSchema = z.object({
  data: z.array(storageImageReferenceSchema),
  updated_at: itemRevisionSchema,
});

export const storageItemImageDeleteResponseSchema = z.object({
  ok: z.literal(true),
  updated_at: itemRevisionSchema,
});

export const storageTransactionsListQuerySchema = z.object({
  storage_id: z.string().trim().min(1).max(128).optional(),
  item_id: z.string().trim().min(1).max(128).optional(),
  recipient_user_id: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).max(MAX_OFFSET_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const storageTreeResponseSchema = z.object({
  data: z.array(storageSchema),
});

export const storageItemsCursorResponseSchema = z.object({
  data: z.array(storageItemSchema),
  next_cursor: z.string().nullable(),
});

export const storageTransactionsPageResponseSchema = z.object({
  data: z.array(storageTransactionSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
  total_pages: z.number().int().min(1),
});

export type Storage = z.infer<typeof storageSchema>;
export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type StorageItem = z.infer<typeof storageItemSchema>;
export type StorageTransaction = z.infer<typeof storageTransactionSchema>;
export type StorageCategoryMutationResponse = z.infer<typeof storageCategoryMutationResponseSchema>;
export type StorageCategoryDeleteResponse = z.infer<typeof storageCategoryDeleteResponseSchema>;
export type StorageItemImageUploadResponse = z.infer<typeof storageItemImageUploadResponseSchema>;
export type StorageItemImageDeleteResponse = z.infer<typeof storageItemImageDeleteResponseSchema>;
export type StorageStockFilter = z.infer<typeof storageStockFilterSchema>;
export type StorageItemsListQuery = z.infer<typeof storageItemsListQuerySchema>;
export type StorageTransactionsListQuery = z.infer<typeof storageTransactionsListQuerySchema>;
export type CreateStoragePayload = z.input<typeof createStorageSchema>;
export type CreateStorageCategoryPayload = z.input<typeof createStorageCategorySchema>;
export type UpdateStoragePayload = z.input<typeof updateStorageSchema>;
export type UpdateStorageCategoryPayload = z.input<typeof updateStorageCategorySchema>;
export type CreateStorageItemPayload = z.input<typeof createStorageItemSchema>;
export type UpdateStorageItemPayload = z.input<typeof updateStorageItemSchema>;
export type DeleteStoragePayload = z.input<typeof deleteStorageSchema>;
export type DeleteStorageCategoryPayload = z.input<typeof deleteStorageCategorySchema>;
export type DeleteStorageItemPayload = z.input<typeof deleteStorageItemSchema>;
export type StorageItemImageMutationPayload = z.input<typeof storageItemImageMutationSchema>;
export type CreateStorageTransactionPayload = z.input<typeof createStorageTransactionSchema>;
export type CreateStorageBatchTransactionPayload = z.input<typeof createStorageBatchTransactionSchema>;
export type StorageBatchTransactionResult = z.infer<typeof storageBatchTransactionResultSchema>;
