import { Button, Skeleton, Stack } from "@mantine/core";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
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

  const confirmDelete = (title: string) => confirm({
      title,
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });

  return (
    <PageLayout
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
      <Stack gap="lg">
        {treeQuery.isLoading ? (
          <Skeleton height={420} radius="md" className="storage-loading" />
        ) : (
          <StorageStructureManager
              storages={storages}
              selectedStorage={selectedStorage}
              selectedCategoryId={selectedCategoryId}
              onSelectStorage={(storageId) => {
                selectStructure(storageId, null);
              }}
              onSelectCategory={(storageId, categoryId) => {
                selectStructure(storageId, categoryId);
              }}
              onCreateStorage={(payload) =>
                mutations.createStorageMutation.mutateAsync(payload).then(
                  (storage) => {
                    selectStructure(storage.id, null);
                    return true;
                  },
                  () => false,
                )}
              onUpdateStorage={(id, payload) =>
                mutations.updateStorageMutation.mutateAsync({ id, payload }).then(
                  () => true,
                  () => false,
                )}
              onDeleteStorage={async (id) => {
                if (!await confirmDelete(t("confirm.deleteStorage"))) return false;
                return mutations.deleteStorageMutation.mutateAsync(id).then(
                  () => {
                      selectStructure(null, null);
                      return true;
                    },
                  () => false,
                );
              }}
              onCreateCategory={(storageId, payload) =>
                mutations.createCategoryMutation.mutateAsync(
                  { storageId, payload },
                ).then(
                  (category) => {
                      selectStructure(storageId, category.id);
                      return true;
                    },
                  () => false,
                )}
              onUpdateCategory={(storageId, categoryId, payload) =>
                mutations.updateCategoryMutation.mutateAsync({ storageId, categoryId, payload }).then(
                  () => true,
                  () => false,
                )}
              onDeleteCategory={async (storageId, categoryId) => {
                if (!await confirmDelete(t("confirm.deleteCategory"))) return false;
                return mutations.deleteCategoryMutation.mutateAsync(
                    { storageId, categoryId },
                  ).then(
                    () => {
                        selectStructure(storageId, null);
                        return true;
                      },
                    () => false,
                  );
              }}
          />
        )}
      </Stack>
    </PageLayout>
  );
}
