import { Button, Skeleton, Stack } from "@mantine/core";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import { useTranslation } from "react-i18next";
import { useStorageTree } from "../../hooks/useStorage";
import { useStorageMutations } from "../../hooks/useStorageMutations";
import { StorageStructureManager } from "../feature/storage/StorageStructureManager";
import { PageLayout } from "../layout/PageLayout";
import "./StoragePage.css";

export function StorageManagePage() {
  const { t } = useTranslation("storage");
  const confirm = useConfirmDialog();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    storageId?: string;
    categoryId?: string;
  };
  const treeQuery = useStorageTree();
  const mutations = useStorageMutations();
  const storages = treeQuery.data?.data ?? [];

  const selectedStorage = storages.find((storage) => storage.id === search.storageId)
    ?? storages[0]
    ?? null;
  const selectedCategoryId = selectedStorage?.categories.some(
    (category) => category.id === search.categoryId,
  )
    ? search.categoryId ?? null
    : null;
  const selectStructure = (storageId: string | null, categoryId: string | null) => {
    void navigate({
      to: "/storage/manage",
      search: {
        storageId: storageId ?? undefined,
        categoryId: categoryId ?? undefined,
      },
      replace: true,
      viewTransition: false,
    });
  };

  const confirmDelete = async (title: string, onConfirm: () => void) => {
    const confirmed = await confirm({
      title,
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) onConfirm();
  };

  return (
    <PageLayout
      title={t("manageStorage.title")}
      subtitle={t("manageStorage.subtitle")}
      className="storage-page storage-manage-page"
      actions={(
        <Button
          component={Link}
          to="/storage"
          search={(selectedStorage ? { storageId: selectedStorage.id } : {}) as never}
          variant="default"
          leftSection={<ArrowLeftIcon size={16} />}
        >
          {t("action.backToStorage")}
        </Button>
      )}
    >
      <Stack gap="md">
        {treeQuery.isLoading ? (
          <Skeleton height={420} radius="md" className="storage-loading" />
        ) : (
          <PageLayout.Section className="storage-management-section">
            <StorageStructureManager
              storages={storages}
              selectedStorage={selectedStorage}
              selectedCategoryId={selectedCategoryId}
              isSaving={
                mutations.createStorageMutation.isPending
                || mutations.updateStorageMutation.isPending
                || mutations.createCategoryMutation.isPending
                || mutations.updateCategoryMutation.isPending
              }
              isDeleting={
                mutations.deleteStorageMutation.isPending
                || mutations.deleteCategoryMutation.isPending
              }
              onSelectStorage={(storageId) => {
                selectStructure(storageId, null);
              }}
              onSelectCategory={(storageId, categoryId) => {
                selectStructure(storageId, categoryId);
              }}
              onCreateStorage={(payload, onSuccess) => {
                mutations.createStorageMutation.mutate(payload, {
                  onSuccess: (storage) => {
                    selectStructure(storage.id, null);
                    onSuccess();
                  },
                });
              }}
              onUpdateStorage={(id, payload) => {
                mutations.updateStorageMutation.mutate({ id, payload });
              }}
              onDeleteStorage={(id) => {
                void confirmDelete(t("confirm.deleteStorage"), () => {
                  mutations.deleteStorageMutation.mutate(id, {
                    onSuccess: () => {
                      selectStructure(null, null);
                    },
                  });
                });
              }}
              onCreateCategory={(storageId, payload, onSuccess) => {
                mutations.createCategoryMutation.mutate(
                  { storageId, payload },
                  {
                    onSuccess: (category) => {
                      selectStructure(storageId, category.id);
                      onSuccess();
                    },
                  },
                );
              }}
              onUpdateCategory={(storageId, categoryId, payload) => {
                mutations.updateCategoryMutation.mutate({ storageId, categoryId, payload });
              }}
              onDeleteCategory={(storageId, categoryId) => {
                void confirmDelete(t("confirm.deleteCategory"), () => {
                  mutations.deleteCategoryMutation.mutate(
                    { storageId, categoryId },
                    {
                      onSuccess: () => {
                        selectStructure(storageId, null);
                      },
                    },
                  );
                });
              }}
            />
          </PageLayout.Section>
        )}
      </Stack>
    </PageLayout>
  );
}
