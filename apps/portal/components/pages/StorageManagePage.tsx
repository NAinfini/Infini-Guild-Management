import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import { Skeleton } from "@portal/components/ui/skeleton";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useTranslation } from "react-i18next";
import { useStorageTree } from "../../hooks/useStorage";
import { useStorageMutations } from "../../hooks/useStorageMutations";
import { StorageStructureManager } from "../feature/storage/StorageStructureManager";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
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
  const treeBlockingError = treeQuery.isError && storages.length === 0;
  const treeRefreshError = treeQuery.isError && storages.length > 0;

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
          render={<Link to="/storage" search={(selectedStorage ? { storageId: selectedStorage.id } : {}) as never} />}
          nativeButton={false}
          variant="outline"
        >
          <ArrowLeftIcon size={16} />
          {t("action.backToStorage")}
        </Button>
      )}
    >
      <div className="storage-manage-page__workspace">
        {treeQuery.isLoading ? (
          <Skeleton className="storage-loading storage-loading--manage" />
        ) : treeBlockingError ? (
          <EmptyState
            status="error"
            title={t("common:loadError")}
            description={t("common:errors.connectionIssue")}
            actions={(
              <Button
                loading={treeQuery.isFetching}
                onClick={() => void treeQuery.refetch()}
              >
                {t("common:action.retry")}
              </Button>
            )}
          />
        ) : (
          <>
            {treeRefreshError ? (
              <Alert variant="destructive" className="storage-inline-alert">
                <AlertTitle>{t("common:loadError")}</AlertTitle>
                <AlertDescription>
                  <span>{t("common:errors.connectionIssue")}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={treeQuery.isFetching}
                    onClick={() => void treeQuery.refetch()}
                  >
                    {t("common:action.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
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
                    return storage;
                  },
                  () => null,
                )}
              onUpdateStorage={(id, payload) =>
                mutations.updateStorageMutation.mutateAsync({ id, payload }).then(
                  (storage) => storage,
                  () => null,
                )}
              onDeleteStorage={async (id, expectedStructureRevision) => {
                if (!await confirmDelete(t("confirm.deleteStorage"))) return false;
                return mutations.deleteStorageMutation.mutateAsync({
                  id,
                  payload: { expected_structure_revision: expectedStructureRevision },
                }).then(
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
                  (response) => {
                    selectStructure(storageId, response.category.id);
                    return response;
                  },
                  () => null,
                )}
              onUpdateCategory={(storageId, categoryId, payload) =>
                mutations.updateCategoryMutation.mutateAsync({ storageId, categoryId, payload }).then(
                  (response) => response,
                  () => null,
                )}
              onDeleteCategory={async (storageId, categoryId, expectedStructureRevision) => {
                if (!await confirmDelete(t("confirm.deleteCategory"))) return false;
                return mutations.deleteCategoryMutation.mutateAsync(
                  {
                    storageId,
                    categoryId,
                    payload: { expected_structure_revision: expectedStructureRevision },
                  },
                ).then(
                  () => {
                    selectStructure(storageId, null);
                    return true;
                  },
                  () => false,
                );
              }}
            />
          </>
        )}
      </div>
    </PageLayout>
  );
}
