import { LIMITS, type StorageStockFilter } from "@guild/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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

type UseStorageItemsOptions = {
  storageId?: string;
  categoryId?: string | null;
  search?: string;
  stock?: StorageStockFilter;
  limit?: number;
  enabled?: boolean;
};

export function useStorageItems({
  storageId,
  categoryId = null,
  search = "",
  stock = "all",
  limit = LIMITS.pagination.storage,
  enabled = true,
}: UseStorageItemsOptions) {
  const normalizedSearch = search.trim();
  const query = useInfiniteQuery({
    queryKey: queryKeys.storage.items(
      storageId ?? "all",
      categoryId,
      normalizedSearch,
      stock,
      limit,
    ),
    queryFn: ({ pageParam }) => fetchStorageItems({
      storageId,
      categoryId,
      search: normalizedSearch || undefined,
      stock,
      cursor: pageParam ?? undefined,
      limit,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: enabled && Boolean(storageId),
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  return { ...query, items };
}

export function useStorageItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.storage.item(id),
    queryFn: () => fetchStorageItem(id as string),
    enabled: Boolean(id),
  });
}

export function useStorageTransactions(params: {
  storageId?: string;
  itemId?: string;
  recipientUserId?: string;
  page: number;
  limit?: number;
  enabled?: boolean;
}) {
  const filter = [
    params.storageId ? `storage:${params.storageId}` : null,
    params.itemId ? `item:${params.itemId}` : null,
    params.recipientUserId ? `recipient:${params.recipientUserId}` : null,
  ].filter((value): value is string => value !== null).join("|") || "all";
  const limit = params.limit ?? 50;
  return useQuery({
    queryKey: queryKeys.storage.transactions(filter, params.page, limit),
    queryFn: () => fetchStorageTransactions(params),
    enabled: params.enabled ?? true,
  });
}
