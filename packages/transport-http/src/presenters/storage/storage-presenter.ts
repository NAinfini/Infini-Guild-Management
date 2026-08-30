import {
  mediaIdSchema,
  storageBatchTransactionResultSchema,
  storageCategorySchema,
  storageCategoryDeleteResponseSchema,
  storageCategoryMutationResponseSchema,
  storageItemImageDeleteResponseSchema,
  storageItemImageUploadResponseSchema,
  storageItemSchema,
  storageItemsCursorResponseSchema,
  storageSchema,
  storageTransactionSchema,
  storageTransactionsPageResponseSchema,
  storageTreeResponseSchema,
  type Storage,
  type StorageBatchTransactionResult,
  type StorageCategory,
  type StorageCategoryDeleteResponse,
  type StorageCategoryMutationResponse,
  type StorageItem,
  type StorageItemImageDeleteResponse,
  type StorageItemImageUploadResponse,
  type StorageTransaction,
} from "@guild/shared";
import { z } from "zod";

const okSchema = z.object({ ok: z.literal(true) });
const mediaIdsSchema = z.array(z.object({ media_id: mediaIdSchema }));

export function presentStorageTree(value: unknown): { data: Storage[] } {
  return storageTreeResponseSchema.parse(value);
}

export function presentStorage(value: unknown): Storage {
  return storageSchema.parse(value);
}

export function presentStorageCategory(value: unknown): StorageCategory {
  return storageCategorySchema.parse(value);
}

export function presentStorageCategoryMutation(value: unknown): StorageCategoryMutationResponse {
  return storageCategoryMutationResponseSchema.parse(value);
}

export function presentStorageCategoryDelete(value: unknown): StorageCategoryDeleteResponse {
  return storageCategoryDeleteResponseSchema.parse(value);
}

export function presentStorageItems(value: unknown): { data: StorageItem[]; next_cursor: string | null } {
  return storageItemsCursorResponseSchema.parse(value);
}

export function presentStorageItem(value: unknown): StorageItem {
  return storageItemSchema.parse(value);
}

export function presentStorageTransaction(value: unknown): StorageTransaction {
  return storageTransactionSchema.parse(value);
}

export function presentStorageBatch(value: unknown): StorageBatchTransactionResult {
  return storageBatchTransactionResultSchema.parse(value);
}

export function presentStorageTransactions(value: unknown) {
  return storageTransactionsPageResponseSchema.parse(value);
}

export function presentStorageMediaIds(value: unknown): Array<{ media_id: string }> {
  return mediaIdsSchema.parse(value);
}

export function presentStorageImageUpload(value: unknown): StorageItemImageUploadResponse {
  return storageItemImageUploadResponseSchema.parse(value);
}

export function presentStorageImageDelete(value: unknown): StorageItemImageDeleteResponse {
  return storageItemImageDeleteResponseSchema.parse(value);
}

export function presentStorageOk(value: unknown): { ok: true } {
  return okSchema.parse(value);
}
