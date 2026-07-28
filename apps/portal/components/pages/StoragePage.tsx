import type { CreateStorageTransactionPayload, StorageItem } from "@guild/shared";
import { Button, Skeleton, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/components/shared/ConfirmDialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useStorageItem, useStorageItems, useStorageTree } from "../../hooks/useStorage";
import { useStorageMutations } from "../../hooks/useStorageMutations";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { StorageInventoryPanel } from "../feature/storage/StorageInventoryPanel";
import {
  StorageBatchPanel,
  type StorageBatchDirection,
  type StorageBatchDraft,
} from "../feature/storage/StorageBatchPanel";
import { StorageItemDetailModal } from "../feature/storage/StorageItemDetailModal";
import { StorageItemEditorModal } from "../feature/storage/StorageItemEditorModal";
import { StorageTransactionModal } from "../feature/storage/StorageTransactionModal";
import { PageLayout } from "../layout/PageLayout";
import { PageTabPanel, PageTabs } from "../layout/PageTabs";
import { EmptyState } from "../shared/EmptyState";
import "./StoragePage.css";

type TransactionMode = CreateStorageTransactionPayload["type"];
type ActiveModal =
  | { type: "detail"; item: StorageItem }
  | { type: "item-editor"; item: StorageItem | null }
  | { type: "transaction"; item: StorageItem | null; mode: TransactionMode }
  | null;

function createBatchDraft(recipientUserId: string | null): StorageBatchDraft {
  return {
    idempotencyKey: crypto.randomUUID(),
    type: "intake",
    quantities: {},
    itemSnapshots: {},
    recipientUserId,
    note: "",
  };
}

function refreshBatchKey(
  draft: StorageBatchDraft,
  patch: Partial<Omit<StorageBatchDraft, "idempotencyKey">>,
): StorageBatchDraft {
  return { ...draft, ...patch, idempotencyKey: crypto.randomUUID() };
}

export function StoragePage() {
  const { t } = useTranslation("storage");
  const confirm = useConfirmDialog();
  const user = useAuthStore((state) => state.user);
  const { canManage } = useEffectivePermissions();
  const canManageStructure = canManage(["admin.storage.structure", "admin.storage.manage"]);
  const canManageItems = canManage(["admin.storage.items", "admin.storage.manage"]);
  const canManageStock = canManage(["admin.storage.stock", "admin.storage.manage"]);
  const treeQuery = useStorageTree();
  const storages = treeQuery.data?.data ?? [];
  const { storageId } = useSearch({ strict: false }) as { storageId?: string };
  const activeStorage = storages.find((storage) => storage.id === storageId) ?? storages[0] ?? null;
  const inventoryProbeQuery = useStorageItems({
    storageId: activeStorage?.id,
    limit: 1,
  });
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [batchDrafts, setBatchDrafts] = useState<Record<string, StorageBatchDraft>>({});
  const {
    search: manualItemSearch,
    setSearch: setManualItemSearch,
    debouncedSearch: debouncedManualItemSearch,
  } = useDebouncedSearch();
  const activeBatchDraft = activeStorage ? batchDrafts[activeStorage.id] : undefined;
  const detailState = activeModal?.type === "detail" ? activeModal : null;
  const detailItemId = detailState?.item.id ?? null;
  const detailItemQuery = useStorageItem(detailItemId);
  const mutations = useStorageMutations();
  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: canManageStock,
    staleTime: 10 * 60_000,
  });
  const editingItem = activeModal?.type === "item-editor" ? activeModal.item : null;
  const transactionState = activeModal?.type === "transaction" ? activeModal : null;
  const manualEntryOpen = Boolean(
    canManageStock
    && transactionState
    && transactionState.item === null,
  );
  const manualItemsQuery = useStorageItems({
    storageId: activeStorage?.id,
    search: debouncedManualItemSearch,
    enabled: manualEntryOpen,
  });
  const transactionItems = transactionState?.item
    ? [transactionState.item]
    : manualItemsQuery.items;
  const confirmDelete = async (title: string, onConfirm: () => void) => {
    const confirmed = await confirm({
      title,
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
    if (confirmed) onConfirm();
  };
  const updateActiveBatch = (
    updater: (draft: StorageBatchDraft) => StorageBatchDraft | null,
  ) => {
    if (!activeStorage) return;
    setBatchDrafts((current) => {
      const draft = current[activeStorage.id];
      if (!draft) return current;
      const nextDraft = updater(draft);
      const next = { ...current };
      if (nextDraft) {
        next[activeStorage.id] = nextDraft;
      } else {
        delete next[activeStorage.id];
      }
      return next;
    });
  };
  const hasBatchEntries = (draft: StorageBatchDraft) =>
    Object.values(draft.quantities).some((quantity) => quantity > 0);
  const confirmBatchReset = async (title: string): Promise<boolean> => {
    if (!activeBatchDraft || !hasBatchEntries(activeBatchDraft)) return true;
    return confirm({
      title,
      confirmLabel: t("common:action.confirm"),
      cancelLabel: t("common:action.cancel"),
      intent: "warning",
    });
  };
  const handleBatchTypeChange = async (type: StorageBatchDirection) => {
    if (!activeBatchDraft || activeBatchDraft.type === type) return;
    if (!await confirmBatchReset(t("confirm.changeBatchDirection"))) return;
    updateActiveBatch((draft) => refreshBatchKey(draft, {
      type,
      quantities: {},
      itemSnapshots: {},
    }));
  };
  const handleClearBatch = async () => {
    if (!await confirmBatchReset(t("confirm.clearBatch"))) return;
    updateActiveBatch((draft) => refreshBatchKey(draft, {
      quantities: {},
      itemSnapshots: {},
    }));
  };
  const handleCloseBatch = async () => {
    if (!await confirmBatchReset(t("confirm.discardBatch"))) return;
    updateActiveBatch(() => null);
  };
  const handleSubmitBatch = () => {
    if (!activeBatchDraft) return;
    const entries = Object.entries(activeBatchDraft.quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([itemId, quantity]) => ({ item_id: itemId, quantity }))
      .sort((a, b) => a.item_id.localeCompare(b.item_id));
    if (entries.length === 0 || !activeBatchDraft.recipientUserId) return;
    mutations.createBatchTransactionMutation.mutate(
      {
        idempotency_key: activeBatchDraft.idempotencyKey,
        type: activeBatchDraft.type,
        entries,
        recipient_user_id: activeBatchDraft.recipientUserId,
        note: activeBatchDraft.note.trim() || null,
      },
      { onSuccess: () => updateActiveBatch(() => null) },
    );
  };

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("subtitle")}
      className="storage-page"
      actions={canManageStructure ? (
        <Button
          component={Link}
          to="/storage/manage"
          search={(activeStorage ? { storageId: activeStorage.id } : {}) as never}
          variant="default"
          leftSection={<SettingsIcon size={16} />}
        >
          {t("action.manageStructure")}
        </Button>
      ) : undefined}
    >
      <Stack gap="md">
        {treeQuery.isLoading ? (
          <Skeleton height={220} radius="md" className="storage-loading" />
        ) : null}
        {!treeQuery.isLoading && storages.length === 0 ? (
          <EmptyState
            title={t("empty.noStorage")}
            actions={canManageStructure ? (
              <Button component={Link} to="/storage/manage" search={{} as never} leftSection={<PlusIcon size={16} />}>
                {t("action.createStorage")}
              </Button>
            ) : undefined}
          />
        ) : null}
        {!treeQuery.isLoading && storages.length > 0 ? (
          <PageTabs
            defaultValue={storages[0]!.id}
            searchKey="storageId"
            keepMounted={false}
            className="storage-tabs"
            listClassName="storage-tabs__list"
            tabs={storages.map((storage) => ({ value: storage.id, label: storage.name }))}
            listWrapper={(list) => (
              <PageLayout.Section className="storage-tabs-section">{list}</PageLayout.Section>
            )}
          >
            {storages.map((storage) => (
              <PageTabPanel key={storage.id} value={storage.id} pt="md" className="storage-tabs__panel">
                {activeStorage?.id === storage.id ? (
                  <div className={`storage-inventory-layout ${activeBatchDraft ? "storage-inventory-layout--batch" : ""}`}>
                    <StorageInventoryPanel
                      key={storage.id}
                      storage={storage}
                      canManageItems={canManageItems}
                      canManageStock={canManageStock}
                      hasAnyItems={inventoryProbeQuery.items.length > 0}
                      batchDraft={activeBatchDraft}
                      onStartBatch={() => {
                        if (activeBatchDraft) {
                          document.getElementById("storage-batch-panel")?.scrollIntoView({
                            block: "end",
                          });
                          return;
                        }
                        const defaultRecipientId = canManageStock
                          ? usersQuery.data?.data[0]?.user.id ?? user?.id ?? null
                          : user?.id ?? null;
                        setBatchDrafts((current) => ({
                          ...current,
                          [storage.id]: createBatchDraft(defaultRecipientId),
                        }));
                      }}
                      onBatchQuantityChange={(item, quantity) => {
                        updateActiveBatch((draft) => {
                          const quantities = { ...draft.quantities };
                          const itemSnapshots = { ...draft.itemSnapshots };
                          if (quantity > 0) {
                            quantities[item.id] = quantity;
                            itemSnapshots[item.id] = item;
                          } else {
                            delete quantities[item.id];
                            delete itemSnapshots[item.id];
                          }
                          return refreshBatchKey(draft, { quantities, itemSnapshots });
                        });
                      }}
                      onOpenItem={(item) => setActiveModal({ type: "detail", item })}
                      onEditItem={(item) => setActiveModal({ type: "item-editor", item })}
                      onOpenTransaction={(item, mode) => {
                        if (!item) setManualItemSearch("");
                        setActiveModal({ type: "transaction", item, mode });
                      }}
                    />
                    {activeBatchDraft ? (
                      <StorageBatchPanel
                        draft={activeBatchDraft}
                        users={usersQuery.data?.data ?? []}
                        currentUsername={user?.username}
                        canManageStock={canManageStock}
                        isSaving={mutations.createBatchTransactionMutation.isPending}
                        onTypeChange={(type) => { void handleBatchTypeChange(type); }}
                        onRecipientChange={(recipientUserId) => {
                          updateActiveBatch((draft) => refreshBatchKey(draft, { recipientUserId }));
                        }}
                        onNoteChange={(note) => {
                          updateActiveBatch((draft) => refreshBatchKey(draft, { note }));
                        }}
                        onQuantityChange={(itemId, quantity) => {
                          updateActiveBatch((draft) => {
                            const quantities = { ...draft.quantities };
                            if (quantity > 0) {
                              quantities[itemId] = quantity;
                            } else {
                              delete quantities[itemId];
                            }
                            return refreshBatchKey(draft, { quantities });
                          });
                        }}
                        onClear={() => { void handleClearBatch(); }}
                        onClose={() => { void handleCloseBatch(); }}
                        onSubmit={handleSubmitBatch}
                      />
                    ) : null}
                  </div>
                ) : null}
              </PageTabPanel>
            ))}
          </PageTabs>
        ) : null}
      </Stack>

      <StorageItemDetailModal
        opened={activeModal?.type === "detail"}
        item={detailItemQuery.data ?? detailState?.item ?? null}
        onClose={() => setActiveModal(null)}
      />
      <StorageItemEditorModal
        opened={activeModal?.type === "item-editor"}
        selectedStorage={activeStorage}
        categories={activeStorage?.categories ?? []}
        item={editingItem}
        isSaving={mutations.createItemMutation.isPending || mutations.updateItemMutation.isPending}
        isDeleting={mutations.deleteItemMutation.isPending}
        isUploading={mutations.uploadImagesMutation.isPending}
        onClose={() => setActiveModal(null)}
        onCreateItem={(payload) => {
          mutations.createItemMutation.mutate(payload, { onSuccess: () => setActiveModal(null) });
        }}
        onUpdateItem={(id, payload) => mutations.updateItemMutation.mutate({ id, payload })}
        onDeleteItem={(id) => {
          void confirmDelete(t("confirm.deleteItem"), () => {
            mutations.deleteItemMutation.mutate(id, { onSuccess: () => setActiveModal(null) });
          });
        }}
        onUploadImages={(itemId, files) => mutations.uploadImagesMutation.mutate({ itemId, files })}
        onDeleteImage={(itemId, imageId) => {
          void confirmDelete(t("confirm.deleteImage"), () => {
            mutations.deleteImageMutation.mutate({ itemId, imageId });
          });
        }}
      />
      <StorageTransactionModal
        opened={activeModal?.type === "transaction"}
        items={transactionItems}
        users={usersQuery.data?.data ?? []}
        initialItem={transactionState?.item ?? null}
        initialMode={transactionState?.mode ?? "intake"}
        canManageStock={canManageStock}
        itemsHasMore={manualEntryOpen && Boolean(manualItemsQuery.hasNextPage)}
        itemsLoadingMore={manualItemsQuery.isFetchingNextPage}
        itemSearch={manualEntryOpen ? manualItemSearch : undefined}
        defaultRecipientUserId={user?.id}
        isSaving={mutations.createTransactionMutation.isPending}
        onItemSearchChange={manualEntryOpen ? setManualItemSearch : undefined}
        onLoadMoreItems={() => void manualItemsQuery.fetchNextPage()}
        onClose={() => setActiveModal(null)}
        onSubmit={(itemId, payload) => {
          mutations.createTransactionMutation.mutate(
            { itemId, payload },
            { onSuccess: () => setActiveModal(null) },
          );
        }}
      />
    </PageLayout>
  );
}
