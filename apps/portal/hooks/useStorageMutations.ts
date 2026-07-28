import type {
  CreateStorageCategoryPayload,
  CreateStorageBatchTransactionPayload,
  CreateStorageItemPayload,
  CreateStoragePayload,
  CreateStorageTransactionPayload,
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
  const resetStorage = async () => {
    await queryClient.resetQueries({ queryKey: queryKeys.storage.all });
  };
  const onError = (error: unknown) => presentAppError(error, t("message.operationFailed"));

  const createStorageMutation = useMutation({
    mutationFn: (payload: CreateStoragePayload) => createStorage(payload),
    onSuccess: async () => { notifySuccess(t("message.storageCreated")); await resetStorage(); },
    onError,
  });

  const updateStorageMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateStoragePayload> }) => updateStorage(id, payload),
    onSuccess: async () => { notifySuccess(t("message.storageUpdated")); await resetStorage(); },
    onError,
  });

  const deleteStorageMutation = useMutation({
    mutationFn: deleteStorage,
    onSuccess: async () => { notifySuccess(t("message.storageDeleted")); await resetStorage(); },
    onError,
  });

  const createCategoryMutation = useMutation({
    mutationFn: ({ storageId, payload }: { storageId: string; payload: CreateStorageCategoryPayload }) => createStorageCategory(storageId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await resetStorage(); },
    onError,
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId, payload }: { storageId: string; categoryId: string; payload: CreateStorageCategoryPayload }) => updateStorageCategory(storageId, categoryId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await resetStorage(); },
    onError,
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId }: { storageId: string; categoryId: string }) => deleteStorageCategory(storageId, categoryId),
    onSuccess: async () => { notifySuccess(t("message.categoryDeleted")); await resetStorage(); },
    onError,
  });

  const createItemMutation = useMutation({
    mutationFn: (payload: CreateStorageItemPayload) => createStorageItem(payload),
    onSuccess: async () => { notifySuccess(t("message.itemCreated")); await resetStorage(); },
    onError,
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateStorageItemPayload }) => updateStorageItem(id, payload),
    onSuccess: async () => { notifySuccess(t("message.itemUpdated")); await resetStorage(); },
    onError,
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteStorageItem,
    onSuccess: async () => { notifySuccess(t("message.itemDeleted")); await resetStorage(); },
    onError,
  });

  const uploadImagesMutation = useMutation({
    mutationFn: ({ itemId, files }: { itemId: string; files: File[] }) => uploadStorageItemImages(itemId, files),
    onSuccess: async () => { notifySuccess(t("message.imagesUploaded")); await resetStorage(); },
    onError,
  });

  const deleteImageMutation = useMutation({
    mutationFn: ({ itemId, imageId }: { itemId: string; imageId: string }) => deleteStorageItemImage(itemId, imageId),
    onSuccess: async () => { notifySuccess(t("message.imageDeleted")); await resetStorage(); },
    onError,
  });

  const createTransactionMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: CreateStorageTransactionPayload }) => createStorageTransaction(itemId, payload),
    onSuccess: async () => { notifySuccess(t("message.transactionSaved")); await resetStorage(); },
    onError,
  });

  const createBatchTransactionMutation = useMutation({
    mutationFn: (payload: CreateStorageBatchTransactionPayload) => createStorageBatchTransaction(payload),
    onSuccess: async () => { notifySuccess(t("message.batchSaved")); await resetStorage(); },
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
