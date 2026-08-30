import {
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageBatchTransactionSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  deleteStorageCategorySchema,
  deleteStorageItemSchema,
  deleteStorageSchema,
  storageItemImageMutationSchema,
  updateStorageCategorySchema,
  updateStorageItemSchema,
  updateStorageSchema,
  type CreateStorageCategoryPayload,
  type CreateStorageBatchTransactionPayload,
  type CreateStorageItemPayload,
  type CreateStoragePayload,
  type CreateStorageTransactionPayload,
  type DeleteStorageCategoryPayload,
  type DeleteStorageItemPayload,
  type DeleteStoragePayload,
  type Storage,
  type StorageBatchTransactionResult,
  type StorageCategoryMutationResponse,
  type StorageItem,
  type StorageItemImageDeleteResponse,
  type StorageItemImageUploadResponse,
  type StorageTransaction,
  type UpdateStorageCategoryPayload,
  type UpdateStorageItemPayload,
  type UpdateStoragePayload,
} from "@guild/shared";
import { apiRequest } from "../client";
import { appendImageUploadVariants, convertImagesForUpload } from "../../utils/upload-media";

export function createStorage(payload: CreateStoragePayload): Promise<Storage> {
  return apiRequest<Storage>("/api/storage/storages", { method: "POST", bodyJson: createStorageSchema.parse(payload) });
}

export function updateStorage(id: string, payload: UpdateStoragePayload): Promise<Storage> {
  return apiRequest<Storage>(`/api/storage/storages/${id}`, { method: "PATCH", bodyJson: updateStorageSchema.parse(payload) });
}

export function deleteStorage(id: string, payload: DeleteStoragePayload): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/storages/${id}`, {
    method: "DELETE",
    bodyJson: deleteStorageSchema.parse(payload),
  });
}

export function createStorageCategory(
  storageId: string,
  payload: CreateStorageCategoryPayload,
): Promise<StorageCategoryMutationResponse> {
  return apiRequest<StorageCategoryMutationResponse>(`/api/storage/storages/${storageId}/categories`, {
    method: "POST",
    bodyJson: createStorageCategorySchema.parse(payload),
  });
}

export function updateStorageCategory(
  storageId: string,
  categoryId: string,
  payload: UpdateStorageCategoryPayload,
): Promise<StorageCategoryMutationResponse> {
  return apiRequest<StorageCategoryMutationResponse>(`/api/storage/storages/${storageId}/categories/${categoryId}`, {
    method: "PATCH",
    bodyJson: updateStorageCategorySchema.parse(payload),
  });
}

export function deleteStorageCategory(
  storageId: string,
  categoryId: string,
  payload: DeleteStorageCategoryPayload,
): Promise<{ ok: true; structure_revision: number }> {
  return apiRequest<{ ok: true; structure_revision: number }>(`/api/storage/storages/${storageId}/categories/${categoryId}`, {
    method: "DELETE",
    bodyJson: deleteStorageCategorySchema.parse(payload),
  });
}

export function createStorageItem(payload: CreateStorageItemPayload): Promise<StorageItem> {
  return apiRequest<StorageItem>("/api/storage/items", { method: "POST", bodyJson: createStorageItemSchema.parse(payload) });
}

export function updateStorageItem(id: string, payload: UpdateStorageItemPayload): Promise<StorageItem> {
  return apiRequest<StorageItem>(`/api/storage/items/${id}`, { method: "PATCH", bodyJson: updateStorageItemSchema.parse(payload) });
}

export function deleteStorageItem(id: string, payload: DeleteStorageItemPayload): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/items/${id}`, {
    method: "DELETE",
    bodyJson: deleteStorageItemSchema.parse(payload),
  });
}

export async function uploadStorageItemImages(
  itemId: string,
  files: File[],
  expectedUpdatedAt: string,
): Promise<StorageItemImageUploadResponse> {
  const converted = await convertImagesForUpload(files);
  const formData = new FormData();
  appendImageUploadVariants(formData, converted);
  formData.append("expected_updated_at", storageItemImageMutationSchema.parse({
    expected_updated_at: expectedUpdatedAt,
  }).expected_updated_at);
  return apiRequest<StorageItemImageUploadResponse>(`/api/storage/items/${itemId}/images`, { method: "POST", body: formData });
}

export function deleteStorageItemImage(
  itemId: string,
  imageId: string,
  expectedUpdatedAt: string,
): Promise<StorageItemImageDeleteResponse> {
  return apiRequest<StorageItemImageDeleteResponse>(`/api/storage/items/${itemId}/images/${imageId}`, {
    method: "DELETE",
    bodyJson: storageItemImageMutationSchema.parse({ expected_updated_at: expectedUpdatedAt }),
  });
}

export function createStorageTransaction(itemId: string, payload: CreateStorageTransactionPayload): Promise<StorageTransaction> {
  return apiRequest<StorageTransaction>(`/api/storage/items/${itemId}/transactions`, { method: "POST", bodyJson: createStorageTransactionSchema.parse(payload) });
}

export function createStorageBatchTransaction(
  payload: CreateStorageBatchTransactionPayload,
): Promise<StorageBatchTransactionResult> {
  return apiRequest<StorageBatchTransactionResult>("/api/storage/transactions/batch", {
    method: "POST",
    bodyJson: createStorageBatchTransactionSchema.parse(payload),
  });
}
