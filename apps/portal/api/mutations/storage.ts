import {
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  updateStorageItemSchema,
  type CreateStorageCategoryPayload,
  type CreateStorageItemPayload,
  type CreateStoragePayload,
  type CreateStorageTransactionPayload,
  type Storage,
  type StorageCategory,
  type StorageItem,
  type StorageTransaction,
  type UpdateStorageItemPayload,
} from "@guild/shared";
import { apiRequest } from "../client";
import { convertImageToWebP } from "../../utils/media-convert";

export function createStorage(payload: CreateStoragePayload): Promise<Storage> {
  return apiRequest<Storage>("/api/storage/storages", { method: "POST", bodyJson: createStorageSchema.parse(payload) });
}

export function updateStorage(id: string, payload: Partial<CreateStoragePayload>): Promise<Storage> {
  return apiRequest<Storage>(`/api/storage/storages/${id}`, { method: "PATCH", bodyJson: createStorageSchema.partial().parse(payload) });
}

export function deleteStorage(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/storages/${id}`, { method: "DELETE" });
}

export function createStorageCategory(storageId: string, payload: CreateStorageCategoryPayload): Promise<StorageCategory> {
  return apiRequest<StorageCategory>(`/api/storage/storages/${storageId}/categories`, { method: "POST", bodyJson: createStorageCategorySchema.parse(payload) });
}

export function updateStorageCategory(storageId: string, categoryId: string, payload: CreateStorageCategoryPayload): Promise<StorageCategory> {
  return apiRequest<StorageCategory>(`/api/storage/storages/${storageId}/categories/${categoryId}`, { method: "PATCH", bodyJson: createStorageCategorySchema.parse(payload) });
}

export function deleteStorageCategory(storageId: string, categoryId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/storages/${storageId}/categories/${categoryId}`, { method: "DELETE" });
}

export function createStorageItem(payload: CreateStorageItemPayload): Promise<StorageItem> {
  return apiRequest<StorageItem>("/api/storage/items", { method: "POST", bodyJson: createStorageItemSchema.parse(payload) });
}

export function updateStorageItem(id: string, payload: UpdateStorageItemPayload): Promise<StorageItem> {
  return apiRequest<StorageItem>(`/api/storage/items/${id}`, { method: "PATCH", bodyJson: updateStorageItemSchema.parse(payload) });
}

export function deleteStorageItem(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/items/${id}`, { method: "DELETE" });
}

export async function uploadStorageItemImages(itemId: string, files: File[]): Promise<Array<{ id: string; r2_key: string }>> {
  const converted = await Promise.all(files.map(convertImageToWebP));
  const formData = new FormData();
  for (const file of converted) {
    formData.append("files", file);
  }
  return apiRequest<Array<{ id: string; r2_key: string }>>(`/api/storage/items/${itemId}/images`, { method: "POST", body: formData });
}

export function deleteStorageItemImage(itemId: string, imageId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/storage/items/${itemId}/images/${imageId}`, { method: "DELETE" });
}

export function createStorageTransaction(itemId: string, payload: CreateStorageTransactionPayload): Promise<StorageTransaction> {
  return apiRequest<StorageTransaction>(`/api/storage/items/${itemId}/transactions`, { method: "POST", bodyJson: createStorageTransactionSchema.parse(payload) });
}
