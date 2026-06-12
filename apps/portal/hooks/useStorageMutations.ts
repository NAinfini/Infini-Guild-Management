import type {
  CreateStorageCategoryPayload,
  CreateStorageItemPayload,
  CreateStoragePayload,
  CreateStorageTransactionPayload,
  StorageIntakeBatchPayload,
  UpdateStorageItemPayload,
} from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  createStorage,
  createStorageCategory,
  createStorageItem,
  createStorageTransaction,
  deleteStorage,
  deleteStorageCategory,
  deleteStorageItem,
  deleteStorageItemImage,
  intakeStorageBatch,
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
  const invalidateStorage = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.storage.all });
  };
  const onError = (error: unknown) => presentAppError(error, t("message.operationFailed"));

  const createStorageMutation = useMutation({
    mutationFn: (payload: CreateStoragePayload) => createStorage(payload),
    onSuccess: async () => { notifySuccess(t("message.storageCreated")); await invalidateStorage(); },
    onError,
  });

  const updateStorageMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateStoragePayload> }) => updateStorage(id, payload),
    onSuccess: async () => { notifySuccess(t("message.storageUpdated")); await invalidateStorage(); },
    onError,
  });

  const deleteStorageMutation = useMutation({
    mutationFn: deleteStorage,
    onSuccess: async () => { notifySuccess(t("message.storageDeleted")); await invalidateStorage(); },
    onError,
  });

  const createCategoryMutation = useMutation({
    mutationFn: ({ storageId, payload }: { storageId: string; payload: CreateStorageCategoryPayload }) => createStorageCategory(storageId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await invalidateStorage(); },
    onError,
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId, payload }: { storageId: string; categoryId: string; payload: CreateStorageCategoryPayload }) => updateStorageCategory(storageId, categoryId, payload),
    onSuccess: async () => { notifySuccess(t("message.categorySaved")); await invalidateStorage(); },
    onError,
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ storageId, categoryId }: { storageId: string; categoryId: string }) => deleteStorageCategory(storageId, categoryId),
    onSuccess: async () => { notifySuccess(t("message.categoryDeleted")); await invalidateStorage(); },
    onError,
  });

  const createItemMutation = useMutation({
    mutationFn: (payload: CreateStorageItemPayload) => createStorageItem(payload),
    onSuccess: async () => { notifySuccess(t("message.itemCreated")); await invalidateStorage(); },
    onError,
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateStorageItemPayload }) => updateStorageItem(id, payload),
    onSuccess: async () => { notifySuccess(t("message.itemUpdated")); await invalidateStorage(); },
    onError,
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteStorageItem,
    onSuccess: async () => { notifySuccess(t("message.itemDeleted")); await invalidateStorage(); },
    onError,
  });

  const uploadImagesMutation = useMutation({
    mutationFn: ({ itemId, files }: { itemId: string; files: File[] }) => uploadStorageItemImages(itemId, files),
    onSuccess: async () => { notifySuccess(t("message.imagesUploaded")); await invalidateStorage(); },
    onError,
  });

  const deleteImageMutation = useMutation({
    mutationFn: ({ itemId, imageId }: { itemId: string; imageId: string }) => deleteStorageItemImage(itemId, imageId),
    onSuccess: async () => { notifySuccess(t("message.imageDeleted")); await invalidateStorage(); },
    onError,
  });

  const createTransactionMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: CreateStorageTransactionPayload }) => createStorageTransaction(itemId, payload),
    onSuccess: async () => { notifySuccess(t("message.transactionSaved")); await invalidateStorage(); },
    onError,
  });

  const intakeBatchMutation = useMutation({
    mutationFn: (payload: StorageIntakeBatchPayload) => intakeStorageBatch(payload),
    onSuccess: async () => { notifySuccess(t("message.batchSaved")); await invalidateStorage(); },
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
    intakeBatchMutation,
  };
}
