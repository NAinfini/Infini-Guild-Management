import type {
  CreateStorageCategoryPayload,
  CreateStorageBatchTransactionPayload,
  CreateStorageItemPayload,
  CreateStoragePayload,
  CreateStorageTransactionPayload,
  StorageItem,
  UpdateStorageItemPayload,
} from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  createStorage,
  createStorageBatchTransaction,
  createStorageCategory,
  createStorageItem,
  createStorageTransaction,
  deleteStorage,
  deleteStorageCategory,
  deleteStorageItem,
  deleteStorageItemImage,
  updateStorage,
  updateStorageCategory,
  updateStorageItem,
  uploadStorageItemImages,
} from "../services/StorageService";
import { presentAppError } from "./useAppError";
import { notifySuccess } from "../utils/notifications";

export function useStorageMutations() {
  const { t } = useTranslation("storage");
  const queryClient = useQueryClient();
  const invalidateTree = () => queryClient.invalidateQueries({ queryKey: queryKeys.storage.tree() });
  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: queryKeys.storage.itemsRoot() });
  const invalidateItem = (itemId: string) => queryClient.invalidateQueries({ queryKey: queryKeys.storage.item(itemId) });
  const invalidateTransactions = () => queryClient.invalidateQueries({
    queryKey: [...queryKeys.storage.all, "transactions"],
  });
  const onError = (error: unknown) => presentAppError(error, t("message.operationFailed"));

  const createStorageMutation = useMutation({
    mutationFn: (payload: CreateStoragePayload) => createStorage(payload),
    onSuccess: async () => { notifySuccess(t("message.storageCreated")); await invalidateTree(); },
    onError,
  });

  const updateStorageMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateStoragePayload> }) => updateStorage(id, payload),
    onSuccess: async () => { notifySuccess(t("message.storageUpdated")); await invalidateTree(); },
    onError,
  });

  const deleteStorageMutation = useMutation({
    mutationFn: deleteStorage,
    onSuccess: async () => {
      notifySuccess(t("message.storageDeleted"));
      await Promise.all([invalidateTree(), invalidateItems(), invalidateTransactions()]);
    },
    onError,
  });

  const createCategoryMutation = useMutation({
    mutationFn: ({ storageId, payload }: { storageId: string; payload: CreateStorageCategoryPayload }) => createStorageCategory(storageId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await Promise.all([invalidateTree(), invalidateItems()]); },
    onError,
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId, payload }: { storageId: string; categoryId: string; payload: CreateStorageCategoryPayload }) => updateStorageCategory(storageId, categoryId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await Promise.all([invalidateTree(), invalidateItems()]); },
    onError,
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId }: { storageId: string; categoryId: string }) => deleteStorageCategory(storageId, categoryId),
    onSuccess: async () => { notifySuccess(t("message.categoryDeleted")); await Promise.all([invalidateTree(), invalidateItems()]); },
    onError,
  });

  const createItemMutation = useMutation({
    mutationFn: (payload: CreateStorageItemPayload) => createStorageItem(payload),
    onSuccess: async (item) => {
      queryClient.setQueryData(queryKeys.storage.item(item.id), item);
      notifySuccess(t("message.itemCreated"));
      await Promise.all([invalidateTree(), invalidateItems()]);
    },
    onError,
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateStorageItemPayload }) => updateStorageItem(id, payload),
    onSuccess: async (item) => {
      queryClient.setQueryData(queryKeys.storage.item(item.id), item);
      notifySuccess(t("message.itemUpdated"));
      await invalidateItems();
    },
    onError,
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteStorageItem,
    onSuccess: async (_response, itemId) => {
      queryClient.removeQueries({ queryKey: queryKeys.storage.item(itemId), exact: true });
      notifySuccess(t("message.itemDeleted"));
      await Promise.all([invalidateTree(), invalidateItems(), invalidateTransactions()]);
    },
    onError,
  });

  const uploadImagesMutation = useMutation({
    mutationFn: ({ itemId, files }: { itemId: string; files: File[] }) => uploadStorageItemImages(itemId, files),
    onSuccess: async (_images, { itemId }) => {
      notifySuccess(t("message.imagesUploaded"));
      await Promise.all([invalidateItem(itemId), invalidateItems()]);
    },
    onError,
  });

  const deleteImageMutation = useMutation({
    mutationFn: ({ itemId, imageId }: { itemId: string; imageId: string }) => deleteStorageItemImage(itemId, imageId),
    onSuccess: async (_response, { itemId }) => {
      notifySuccess(t("message.imageDeleted"));
      await Promise.all([invalidateItem(itemId), invalidateItems()]);
    },
    onError,
  });

  const createTransactionMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: CreateStorageTransactionPayload }) => createStorageTransaction(itemId, payload),
    onSuccess: async (transaction, { itemId }) => {
      queryClient.setQueryData<StorageItem>(queryKeys.storage.item(itemId), (current) => current
        ? { ...current, quantity: Math.max(0, current.quantity + transaction.quantity_delta) }
        : current);
      notifySuccess(t("message.transactionSaved"));
      await Promise.all([invalidateItem(itemId), invalidateItems(), invalidateTransactions()]);
    },
    onError,
  });

  const createBatchTransactionMutation = useMutation({
    mutationFn: (payload: CreateStorageBatchTransactionPayload) => createStorageBatchTransaction(payload),
    onSuccess: async (response) => {
      const itemIds = new Set<string>();
      for (const transaction of response.data) {
        itemIds.add(transaction.item_id);
        queryClient.setQueryData<StorageItem>(queryKeys.storage.item(transaction.item_id), (current) => current
          ? { ...current, quantity: Math.max(0, current.quantity + transaction.quantity_delta) }
          : current);
      }
      notifySuccess(t("message.batchSaved"));
      await Promise.all([
        ...[...itemIds].map(invalidateItem),
        invalidateItems(),
        invalidateTransactions(),
      ]);
    },
    onError,
  });

  return {
    createStorageMutation,
    updateStorageMutation,
    deleteStorageMutation,
    createCategoryMutation,
    updateCategoryMutation,
    deleteCategoryMutation,
    createItemMutation,
    updateItemMutation,
    deleteItemMutation,
    uploadImagesMutation,
    deleteImageMutation,
    createTransactionMutation,
    createBatchTransactionMutation,
  };
}
