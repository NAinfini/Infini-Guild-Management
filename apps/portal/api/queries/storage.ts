import type {
  CursorResponse,
  PaginatedResponse,
  Storage,
  StorageItem,
  StorageStockFilter,
  StorageTransaction,
} from "@guild/shared";
import { apiRequest } from "../client";

export function fetchStorageTree(): Promise<{ data: Storage[] }> {
  return apiRequest<{ data: Storage[] }>("/api/storage");
}

export function fetchStorageItems(params: {
  storageId?: string;
  categoryId?: string | null;
  search?: string;
  stock: StorageStockFilter;
  cursor?: string;
  limit: number;
}): Promise<CursorResponse<StorageItem>> {
  const query = new URLSearchParams();
  if (params.storageId) query.set("storage_id", params.storageId);
  if (params.categoryId) query.set("category_id", params.categoryId);
  if (params.search) query.set("search", params.search);
  query.set("stock", params.stock);
  query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<CursorResponse<StorageItem>>(`/api/storage/items${suffix}`);
}

export function fetchStorageItem(id: string): Promise<StorageItem> {
  return apiRequest<StorageItem>(`/api/storage/items/${id}`);
}

export function fetchStorageTransactions(params: {
  itemId?: string;
  recipientUserId?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<StorageTransaction>> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 50));
  if (params.itemId) query.set("item_id", params.itemId);
  if (params.recipientUserId) query.set("recipient_user_id", params.recipientUserId);
  return apiRequest<PaginatedResponse<StorageTransaction>>(`/api/storage/transactions?${query.toString()}`);
}
