/*
 * THESIS: Storage is a quartermaster workbench, not a dashboard or a wall of cards.
 * OWN-WORLD: Forged Material plates, an underline location rail, dense item rows, and one teal action hierarchy.
 * STORY: Choose a location, narrow the catalog, inspect an item, then record a permitted stock movement.
 * FIRST VIEWPORT: Locations lead, categories anchor the left rail, inventory owns the center, and admin tools stay contextual.
 * FORM: Quartermaster Rail, approved concept A; passive detail uses a drawer and batch state stays pinned above inventory.
 */
import type { CreateStorageTransactionPayload, StorageItem } from "@guild/shared";
import { ActionIcon, Button, Select, Skeleton, Stack, Tabs, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
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
  const navigate = useNavigate();
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
  const activeItemId = activeModal?.type === "detail"
    ? activeModal.item.id
    : activeModal?.type === "item-editor"
      ? activeModal.item?.id ?? null
      : null;
  const activeItemQuery = useStorageItem(activeItemId);
  const mutations = useStorageMutations();
  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: canManageStock,
    staleTime: 10 * 60_000,
  });
  const editingItem = activeModal?.type === "item-editor"
    ? activeItemQuery.data ?? activeModal.item
    : null;
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
  const confirmDelete = (title: string) => confirm({
      title,
      confirmLabel: t("common:action.delete"),
      cancelLabel: t("common:action.cancel"),
      intent: "danger",
    });
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
    <PageLayout className="storage-page">
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
        {!treeQuery.isLoading && activeStorage ? (
          <Stack gap="md">
            <section className="storage-location-rail" aria-label={t("field.storage")}>
              <div className="storage-location-rail__switcher">
                <Tabs
                  className="storage-location-tabs"
                  value={activeStorage.id}
                  onChange={(nextStorageId) => {
                    if (!nextStorageId || nextStorageId === activeStorage.id) return;
                    void navigate({
                      to: "/storage",
                      search: { storageId: nextStorageId },
                      replace: true,
                      viewTransition: false,
                    });
                  }}
                >
                  <Tabs.List>
                    {storages.map((storage) => (
                      <Tabs.Tab key={storage.id} value={storage.id}>
                        {storage.name}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs>

                <Select
                  aria-label={t("field.storage")}
                  className="storage-location-select"
                  data={storages.map((storage) => ({ value: storage.id, label: storage.name }))}
                  value={activeStorage.id}
                  onChange={(nextStorageId) => {
                    if (!nextStorageId || nextStorageId === activeStorage.id) return;
                    void navigate({
                      to: "/storage",
                      search: { storageId: nextStorageId },
                      replace: true,
                      viewTransition: false,
                    });
                  }}
                />

                {canManageStructure ? (
                  <Tooltip label={t("action.manageStructure")} position="bottom">
                    <ActionIcon
                      aria-label={t("action.manageStructure")}
                      className="storage-location-rail__manage"
                      component={Link}
                      to="/storage/manage"
                      search={{ storageId: activeStorage.id } as never}
                      variant="subtle"
                      size={44}
                    >
                      <SettingsIcon size={18} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </div>
            </section>

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

            <StorageInventoryPanel
              key={activeStorage.id}
              storage={activeStorage}
              canManageItems={canManageItems}
              canManageStock={canManageStock}
              hasAnyItems={inventoryProbeQuery.items.length > 0}
              batchDraft={activeBatchDraft}
              onStartBatch={() => {
                if (activeBatchDraft) {
                  document.getElementById("storage-batch-panel")?.scrollIntoView({
                    block: "start",
                  });
                  return;
                }
                /*
                 * 管理员必须自己选领取人：这条记录决定这批货算在谁头上。
                 * 之前默认填成员列表的第一个人，管理员忘记改就会把整批货
                 * 静默记到一个无关的人身上——默认值在这里等于伪造凭据。
                 * 普通成员没有选择权（面板上是只读徽章），领取人就是本人。
                 */
                const defaultRecipientId = canManageStock ? null : user?.id ?? null;
                setBatchDrafts((current) => ({
                  ...current,
                  [activeStorage.id]: createBatchDraft(defaultRecipientId),
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
          </Stack>
        ) : null}
      </Stack>

      <StorageItemDetailModal
        opened={activeModal?.type === "detail"}
        item={activeItemQuery.data ?? detailState?.item ?? null}
        canEditItem={canManageItems}
        canManageStock={canManageStock}
        onClose={() => setActiveModal(null)}
        onDeposit={(item) => setActiveModal({ type: "transaction", item, mode: "intake" })}
        onWithdraw={(item) => setActiveModal({ type: "transaction", item, mode: "distribute" })}
        onEdit={(item) => setActiveModal({ type: "item-editor", item })}
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
          mutations.createItemMutation.mutate(payload, {
            onSuccess: (createdItem) => {
              /*
               * 新建成功后抽屉留在编辑态，让用户接着传图。
               * 但必须先确认它还开着：请求飞行期间用户完全可能已经点了取消，
               * 无条件 setActiveModal 会把关掉的抽屉又弹回来，挡住整页。
               */
              setActiveModal((current) => (
                current?.type === "item-editor"
                  ? { type: "item-editor", item: createdItem }
                  : current
              ));
            },
          });
        }}
        onUpdateItem={(id, payload) => mutations.updateItemMutation.mutate({ id, payload })}
        onDeleteItem={(id) => {
          void confirmDelete(t("confirm.deleteItem")).then((confirmed) => {
            if (confirmed) {
              mutations.deleteItemMutation.mutate(id, { onSuccess: () => setActiveModal(null) });
            }
          });
        }}
        onUploadImages={(itemId, files) => mutations.uploadImagesMutation.mutate({ itemId, files })}
        onDeleteImage={async (itemId, imageId) => {
          if (!await confirmDelete(t("confirm.deleteImage"))) return false;
          return mutations.deleteImageMutation.mutateAsync({ itemId, imageId }).then(
            () => true,
            () => false,
          );
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
