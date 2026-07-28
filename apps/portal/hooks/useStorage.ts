import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-keys";
import {
  fetchStorageItem,
  fetchStorageItems,
  fetchStorageTransactions,
  fetchStorageTree,
} from "../services/StorageService";

export function useStorageTree() {
  return useQuery({
    queryKey: queryKeys.storage.tree(),
    queryFn: fetchStorageTree,
  });
}

export function useStorageItems(storageId?: string, categoryId?: string | null, search = "") {
  return useQuery({
    queryKey: queryKeys.storage.items(storageId ?? "all", categoryId ?? null, search.trim()),
    queryFn: () => fetchStorageItems({ storageId, categoryId, search: search.trim() || undefined }),
    enabled: Boolean(storageId),
  });
}

export function useStorageItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.storage.item(id),
    queryFn: () => fetchStorageItem(id as string),
    enabled: Boolean(id),
  });
}

export function useStorageTransactions(params: {
  itemId?: string;
  recipientUserId?: string;
  page: number;
  limit?: number;
  enabled?: boolean;
}) {
  const filter = params.itemId ? `item:${params.itemId}` : params.recipientUserId ? `recipient:${params.recipientUserId}` : "all";
  const limit = params.limit ?? 50;
  return useQuery({
    queryKey: queryKeys.storage.transactions(filter, params.page, limit),
    queryFn: () => fetchStorageTransactions(params),
    placeholderData: keepPreviousData,
    enabled: params.enabled ?? true,
  });
}
