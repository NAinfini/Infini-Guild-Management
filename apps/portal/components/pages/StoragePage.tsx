import type { CreateStorageTransactionPayload, StorageItem } from "@guild/shared";
import { ClipboardIcon, PlusIcon, SearchIcon, SettingsIcon } from "@portal/components/icons";
import { Button, Group, Select, Skeleton, Stack, Tabs, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../../api/query-keys";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useStorageItem, useStorageItems, useStorageTransactions, useStorageTree } from "../../hooks/useStorage";
import { useStorageMutations } from "../../hooks/useStorageMutations";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { useAuthStore } from "../../stores/auth";
import { resolveStorageMediaUrl } from "../../utils/media";
import { StorageAdminTransactionModal } from "../feature/storage/StorageAdminTransactionModal";
import { StorageItemCard } from "../feature/storage/StorageItemCard";
import { StorageItemDetailModal } from "../feature/storage/StorageItemDetailModal";
import { StorageItemEditorModal } from "../feature/storage/StorageItemEditorModal";
import { StorageManagementModal } from "../feature/storage/StorageManagementModal";
import { StorageTransactionModal } from "../feature/storage/StorageTransactionModal";
import { PageLayout } from "../layout/PageLayout";
import { EmptyState } from "../shared/EmptyState";
import "./StoragePage.css";

type StockFilter = "all" | "available" | "empty" | "deposit" | "withdraw";
type TransactionMode = CreateStorageTransactionPayload["type"];

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function filterItems(items: StorageItem[], stockFilter: StockFilter) {
  if (stockFilter === "available") return items.filter((item) => item.quantity > 0);
  if (stockFilter === "empty") return items.filter((item) => item.quantity === 0);
  if (stockFilter === "deposit") return items.filter((item) => item.allow_member_deposit);
  if (stockFilter === "withdraw") return items.filter((item) => item.allow_member_withdraw);
  return items;
}

export function StoragePage() {
  const { t } = useTranslation("storage");
  const user = useAuthStore((state) => state.user);
  const { canManage } = useEffectivePermissions();
  const canManageStorageStructure = canManage(["admin.storage.structure", "admin.storage.manage"]);
  const canManageStorageItems = canManage(["admin.storage.items", "admin.storage.manage"]);
  const canManageStorageStock = canManage(["admin.storage.stock", "admin.storage.manage"]);
  const canUseStorageAdminActions = canManageStorageStructure || canManageStorageItems || canManageStorageStock;
  const treeQuery = useStorageTree();
  const storages = treeQuery.data?.data ?? [];
  const [storageId, setStorageId] = useState<string | null>(null);
  const activeStorage = storages.find((storage) => storage.id === (storageId ?? storages[0]?.id)) ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const itemsQuery = useStorageItems(activeStorage?.id, categoryId, search);
  const sortedItems = useMemo(
    () => [...(itemsQuery.data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [itemsQuery.data?.data],
  );
  const items = useMemo(() => filterItems(sortedItems, stockFilter), [sortedItems, stockFilter]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItemQuery = useStorageItem(selectedItemId);
  const selectedItem = selectedItemQuery.data ?? sortedItems.find((item) => item.id === selectedItemId) ?? null;
  const selectedTxQuery = useStorageTransactions({ itemId: selectedItemId ?? undefined, page: 1, limit: 20 });
  const mutations = useStorageMutations();
  const [storageManageOpened, storageManageHandlers] = useDisclosure(false);
  const [manageStorageId, setManageStorageId] = useState<string | null>(null);
  const [manageCategoryId, setManageCategoryId] = useState<string | null>(null);
  const [adminTransactionOpened, adminTransactionHandlers] = useDisclosure(false);
  const [itemEditorOpened, itemEditorHandlers] = useDisclosure(false);
  const [editingItem, setEditingItem] = useState<StorageItem | null>(null);
  const [txItem, setTxItem] = useState<StorageItem | null>(null);
  const [txMode, setTxMode] = useState<Extract<TransactionMode, "intake" | "distribute">>("intake");
  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: canManageStorageStock,
    staleTime: 10 * 60_000,
  });

  const openItemEditor = (item: StorageItem | null) => {
    setEditingItem(item);
    itemEditorHandlers.open();
  };

  const openTransaction = (item: StorageItem, mode: Extract<TransactionMode, "intake" | "distribute">) => {
    setTxItem(item);
    setTxMode(mode);
  };

  const confirmDelete = (title: string, onConfirm: () => void) => {
    modals.openConfirmModal({
      title,
      labels: { confirm: t("common:action.delete"), cancel: t("common:action.cancel") },
      confirmProps: { color: "red" },
      onConfirm,
    });
  };

  const handleStorageChange = (value: string | null) => {
    setStorageId(value);
    setCategoryId(null);
    setStockFilter("all");
  };

  const handleOpenStorageManagement = () => {
    setManageStorageId(activeStorage?.id ?? storages[0]?.id ?? null);
    setManageCategoryId(categoryId);
    storageManageHandlers.open();
  };

  const manageSelectedStorage = storages.find((storage) => storage.id === (manageStorageId ?? activeStorage?.id ?? storages[0]?.id)) ?? null;
  const manageSelectedCategoryId = manageSelectedStorage?.categories.some((category) => category.id === manageCategoryId) ? manageCategoryId : null;

  const handleManageStorageSelect = (id: string) => {
    setManageStorageId(id);
    setManageCategoryId(null);
  };

  const handleManageCategorySelect = (nextStorageId: string, nextCategoryId: string) => {
    setManageStorageId(nextStorageId);
    setManageCategoryId(nextCategoryId);
  };

  const stockFilterOptions = [
    { value: "all", label: t("filter.stockAll") },
    { value: "available", label: t("filter.available") },
    { value: "empty", label: t("filter.empty") },
    { value: "deposit", label: t("filter.depositEnabled") },
    { value: "withdraw", label: t("filter.withdrawEnabled") },
  ];

  return (
    <PageLayout className="storage-page">
      <Stack gap="md">
        {treeQuery.isLoading ? <Skeleton height={220} radius="md" className="storage-loading" /> : null}
        {!treeQuery.isLoading && storages.length === 0 ? <EmptyState title={t("empty.noStorage")} /> : null}

        {!treeQuery.isLoading && storages.length > 0 ? (
          <Tabs value={activeStorage?.id ?? null} onChange={handleStorageChange} keepMounted={false} className="storage-tabs">
            <PageLayout.Section className="storage-tabs-section">
              <Tabs.List className="storage-tabs__list">
                {storages.map((storage) => (
                  <Tabs.Tab key={storage.id} value={storage.id}>
                    {storage.name}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </PageLayout.Section>

            {storages.map((storage) => (
              <Tabs.Panel key={storage.id} value={storage.id} pt="md" className="storage-tabs__panel">
                {activeStorage?.id === storage.id ? (
                  <Stack gap="md">
                    <PageLayout.Section className="storage-toolbar-section">
                      <div className="storage-command">
                        <div className="storage-command__row">
                          <div className="storage-command__primary">
                            <Group gap={6} className="storage-command__categories">
                              <Button size="compact-sm" variant={categoryId === null ? "default" : "subtle"} color="gray" onClick={() => setCategoryId(null)}>{t("filter.all")}</Button>
                              {activeStorage.categories.map((category) => (
                                <Button key={category.id} size="compact-sm" variant={categoryId === category.id ? "default" : "subtle"} color="gray" onClick={() => setCategoryId(category.id)}>
                                  {category.name}
                                </Button>
                              ))}
                            </Group>
                          </div>
                          <div className="storage-command__filters">
                            <Select
                              aria-label={t("field.stock")}
                              className="storage-command__stock"
                              data={stockFilterOptions}
                              value={stockFilter}
                              onChange={(value) => setStockFilter((value as StockFilter) ?? "all")}
                            />
                            <TextInput
                              className="storage-command__search"
                              leftSection={<SearchIcon size={15} />}
                              placeholder={t("filter.search")}
                              value={search}
                              onChange={(event) => setSearch(event.currentTarget.value)}
                            />
                          </div>
                          {canUseStorageAdminActions ? (
                            <Group gap={8} className="storage-command__actions">
                              {canManageStorageStructure ? (
                                <Button variant="default" leftSection={<SettingsIcon size={16} />} onClick={handleOpenStorageManagement}>{t("action.manageStructure")}</Button>
                              ) : null}
                              {canManageStorageStock ? (
                                <Button variant="default" leftSection={<ClipboardIcon size={16} />} onClick={adminTransactionHandlers.open} disabled={items.length === 0}>{t("action.manualEntry")}</Button>
                              ) : null}
                              {canManageStorageItems ? (
                                <Button leftSection={<PlusIcon size={16} />} onClick={() => openItemEditor(null)} disabled={!activeStorage}>{t("action.createItem")}</Button>
                              ) : null}
                            </Group>
                          ) : null}
                        </div>
                      </div>
                    </PageLayout.Section>

                    {itemsQuery.isLoading ? <Skeleton height={220} radius="md" className="storage-loading" /> : null}
                    {!itemsQuery.isLoading && items.length === 0 ? <EmptyState title={t("empty.noItems")} /> : null}

                    {items.length > 0 ? (
                      <PageLayout.Section className="storage-items-section">
                        <div className="storage-grid" aria-live="polite">
                          {items.map((item) => (
                            <StorageItemCard
                              key={item.id}
                              item={item}
                              category={activeStorage.categories.find((category) => category.id === item.category_id)}
                              imageUrl={item.images[0] ? resolveStorageMediaUrl(item.images[0].r2_key) : undefined}
                              canEditItems={canManageStorageItems}
                              onOpen={(next) => setSelectedItemId(next.id)}
                              onDeposit={(next) => openTransaction(next, "intake")}
                              onWithdraw={(next) => openTransaction(next, "distribute")}
                              onEdit={openItemEditor}
                              labels={{
                                deposit: t("action.deposit"),
                                withdraw: t("action.withdraw"),
                                edit: t("action.edit"),
                                uncategorized: t("category.uncategorized"),
                                stock: t("field.stock"),
                                depositEnabled: t("badge.depositEnabled"),
                                withdrawEnabled: t("badge.withdrawEnabled"),
                                closed: t("badge.closed"),
                              }}
                            />
                          ))}
                        </div>
                      </PageLayout.Section>
                    ) : null}
                  </Stack>
                ) : null}
              </Tabs.Panel>
            ))}
          </Tabs>
        ) : null}
      </Stack>

      <StorageItemDetailModal
        opened={Boolean(selectedItemId)}
        item={selectedItem}
        transactions={selectedTxQuery.data?.data ?? []}
        resolveImageUrl={resolveStorageMediaUrl}
        formatDateTime={formatDateTime}
        onClose={() => setSelectedItemId(null)}
        labels={{
          stock: t("field.stock"),
          description: t("field.description"),
          noDescription: t("empty.noDescription"),
          ledger: t("ledger.title"),
          emptyLedger: t("ledger.empty"),
          intake: t("tx.intake"),
          distribute: t("tx.distribute"),
          adjust: t("tx.adjust"),
          recipient: t("field.recipient"),
          note: t("field.note"),
          actor: t("field.actor"),
          date: t("field.date"),
          stockChange: t("field.stockChange"),
        }}
      />

      <StorageManagementModal
        opened={storageManageOpened}
        storages={storages}
        selectedStorage={manageSelectedStorage}
        selectedCategoryId={manageSelectedCategoryId}
        isSaving={
          mutations.createStorageMutation.isPending
          || mutations.updateStorageMutation.isPending
          || mutations.createCategoryMutation.isPending
          || mutations.updateCategoryMutation.isPending
        }
        isDeleting={mutations.deleteStorageMutation.isPending || mutations.deleteCategoryMutation.isPending}
        onClose={storageManageHandlers.close}
        onSelectStorage={handleManageStorageSelect}
        onSelectCategory={handleManageCategorySelect}
        onCreateStorage={(payload) => mutations.createStorageMutation.mutate(payload, { onSuccess: (storage) => handleManageStorageSelect(storage.id) })}
        onUpdateStorage={(id, payload) => mutations.updateStorageMutation.mutate({ id, payload })}
        onDeleteStorage={(id) => confirmDelete(t("confirm.deleteStorage"), () => mutations.deleteStorageMutation.mutate(id))}
        onCreateCategory={(nextStorageId, payload) => mutations.createCategoryMutation.mutate(
          { storageId: nextStorageId, payload },
          { onSuccess: (category) => handleManageCategorySelect(nextStorageId, category.id) },
        )}
        onUpdateCategory={(nextStorageId, nextCategoryId, payload) => mutations.updateCategoryMutation.mutate({ storageId: nextStorageId, categoryId: nextCategoryId, payload })}
        onDeleteCategory={(nextStorageId, nextCategoryId) => confirmDelete(t("confirm.deleteCategory"), () => mutations.deleteCategoryMutation.mutate({ storageId: nextStorageId, categoryId: nextCategoryId }))}
        labels={{
          title: t("manageStorage.title"),
          editTitle: t("manageStorage.editTitle"),
          storageList: t("manageStorage.storageList"),
          name: t("field.storageName"),
          description: t("field.storageDescription"),
          emptyDescription: t("empty.noDescription"),
          create: t("action.createStorage"),
          save: t("action.saveStorage"),
          delete: t("action.deleteStorage"),
          cancel: t("common:action.cancel"),
          noStorages: t("empty.noStorage"),
          defaultStorageName: t("manageStorage.defaultStorageName"),
          defaultCategoryName: t("manageStorage.defaultCategoryName"),
          categoryName: t("field.categoryName"),
          editCategoryTitle: t("manageStorage.editCategoryTitle"),
          createCategory: t("action.createCategory"),
          saveCategory: t("action.saveCategory"),
          deleteCategory: t("action.deleteCategory"),
          noCategories: t("empty.noCategories"),
        }}
      />

      <StorageItemEditorModal
        opened={itemEditorOpened}
        selectedStorage={activeStorage}
        categories={activeStorage?.categories ?? []}
        item={editingItem}
        isSaving={mutations.createItemMutation.isPending || mutations.updateItemMutation.isPending}
        isDeleting={mutations.deleteItemMutation.isPending}
        isUploading={mutations.uploadImagesMutation.isPending}
        resolveImageUrl={resolveStorageMediaUrl}
        onClose={() => { setEditingItem(null); itemEditorHandlers.close(); }}
        onCreateItem={(payload) => mutations.createItemMutation.mutate(payload, { onSuccess: itemEditorHandlers.close })}
        onUpdateItem={(id, payload) => mutations.updateItemMutation.mutate({ id, payload })}
        onDeleteItem={(id) => confirmDelete(t("confirm.deleteItem"), () => mutations.deleteItemMutation.mutate(id, { onSuccess: itemEditorHandlers.close }))}
        onUploadImages={(itemId, files) => mutations.uploadImagesMutation.mutate({ itemId, files })}
        onDeleteImage={(itemId, imageId) => confirmDelete(t("confirm.deleteImage"), () => mutations.deleteImageMutation.mutate({ itemId, imageId }))}
        labels={{
          createTitle: t("manageItems.createTitle"),
          editTitle: t("manageItems.editTitle"),
          name: t("field.itemName"),
          description: t("field.description"),
          category: t("field.category"),
          allowDeposit: t("field.allowDeposit"),
          allowWithdraw: t("field.allowWithdraw"),
          uncategorized: t("category.uncategorized"),
          create: t("action.createItem"),
          save: t("action.saveItem"),
          delete: t("action.deleteItem"),
          uploadImages: t("action.uploadImages"),
          uploadHint: t("manageItems.uploadHint"),
          noStorage: t("empty.noStorage"),
          noImages: t("manageItems.noImages"),
        }}
      />

      <StorageTransactionModal
        opened={Boolean(txItem)}
        item={txItem}
        mode={txMode}
        defaultRecipientUserId={user?.id}
        isSaving={mutations.createTransactionMutation.isPending}
        onClose={() => setTxItem(null)}
        onSubmit={(itemId, payload) => mutations.createTransactionMutation.mutate({ itemId, payload }, { onSuccess: () => setTxItem(null) })}
        labels={{
          currentStock: t("field.currentStock"),
          stockAfter: t("field.stockAfter"),
          stockChange: t("field.stockChange"),
          depositTitle: t("action.deposit"),
          withdrawTitle: t("action.withdraw"),
          quantity: t("field.quantity"),
          note: t("field.note"),
          cancel: t("common:action.cancel"),
          submitDeposit: t("action.submitDeposit"),
          submitWithdraw: t("action.submitWithdraw"),
        }}
      />

      <StorageAdminTransactionModal
        opened={adminTransactionOpened}
        items={sortedItems}
        users={usersQuery.data?.data ?? []}
        isSaving={mutations.createTransactionMutation.isPending}
        onClose={adminTransactionHandlers.close}
        onSubmit={(itemId, payload) => mutations.createTransactionMutation.mutate({ itemId, payload }, { onSuccess: adminTransactionHandlers.close })}
        labels={{
          title: t("adminEntry.title"),
          item: t("field.item"),
          member: t("field.member"),
          type: t("field.type"),
          currentStock: t("field.currentStock"),
          stockAfter: t("field.stockAfter"),
          stockChange: t("field.stockChange"),
          quantity: t("field.quantity"),
          note: t("field.note"),
          intake: t("tx.intake"),
          distribute: t("tx.distribute"),
          adjust: t("tx.adjust"),
          targetStock: t("field.targetStock"),
          cancel: t("common:action.cancel"),
          submit: t("action.submit"),
          summary: t("adminEntry.summary"),
          adjustSummary: t("adminEntry.adjustSummary"),
          noItems: t("empty.noItems"),
          noUsers: t("empty.noUsers"),
        }}
      />
    </PageLayout>
  );
}
