import type { Storage, StorageItem, StorageStockFilter } from "@guild/shared";
import {
  Button,
  Group,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  ClipboardIcon,
  PlusIcon,
  SearchIcon,
} from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedSearch } from "../../../hooks/useDebouncedSearch";
import { useStorageItems } from "../../../hooks/useStorage";
import { resolveStorageMediaUrl } from "../../../utils/media";
import { EmptyState } from "../../shared/EmptyState";
import type { StorageBatchDraft } from "./StorageBatchPanel";
import { StorageItemCard } from "./StorageItemCard";

type MemberTransactionMode = "intake" | "distribute";

type StorageInventoryPanelProps = {
  storage: Storage;
  canManageItems: boolean;
  canManageStock: boolean;
  hasAnyItems: boolean;
  batchDraft?: StorageBatchDraft;
  onStartBatch: () => void;
  onBatchQuantityChange: (item: StorageItem, quantity: number) => void;
  onOpenItem: (item: StorageItem) => void;
  onEditItem: (item: StorageItem | null) => void;
  onOpenTransaction: (item: StorageItem | null, mode: MemberTransactionMode) => void;
};

export function StorageInventoryPanel({
  storage,
  canManageItems,
  canManageStock,
  hasAnyItems,
  batchDraft,
  onStartBatch,
  onBatchQuantityChange,
  onOpenItem,
  onEditItem,
  onOpenTransaction,
}: StorageInventoryPanelProps) {
  const { t } = useTranslation("storage");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const { search, setSearch, debouncedSearch } = useDebouncedSearch();
  const [stockFilter, setStockFilter] = useState<StorageStockFilter>("all");
  const itemsQuery = useStorageItems({
    storageId: storage.id,
    categoryId,
    search: debouncedSearch,
    stock: stockFilter,
  });
  const items = itemsQuery.items;
  const stockFilterOptions = [
    { value: "all", label: t("filter.stockAll") },
    { value: "available", label: t("filter.available") },
    { value: "empty", label: t("filter.empty") },
    { value: "deposit", label: t("filter.depositEnabled") },
    { value: "withdraw", label: t("filter.withdrawEnabled") },
  ];
  const categoryOptions = [
    { value: "__all", label: t("filter.all") },
    ...storage.categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];
  const batchEntryCount = batchDraft
    ? Object.values(batchDraft.quantities).filter((quantity) => quantity > 0).length
    : 0;
  const batchLimitReached = batchEntryCount >= 20;

  return (
    <div className="storage-inventory-shell">
      <aside className="storage-category-rail" aria-label={t("filter.category")}>
        <div className="storage-category-rail__header">
          <Text fw={800}>{t("inventory.categories")}</Text>
          <Text size="xs" c="dimmed">{storage.categories.length}</Text>
        </div>
        <nav className="storage-category-rail__nav" aria-label={t("filter.category")}>
          {categoryOptions.map((category) => {
            const active = (category.value === "__all" && categoryId === null)
              || category.value === categoryId;
            return (
              <button
                key={category.value}
                type="button"
                className={`storage-category-rail__item ${active ? "storage-category-rail__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setCategoryId(category.value === "__all" ? null : category.value)}
              >
                <span>{category.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="storage-inventory-main" aria-label={t("inventory.title")}>
        <div className="storage-command">
          <Select
            aria-label={t("filter.category")}
            className="storage-command__category-mobile"
            data={categoryOptions}
            value={categoryId ?? "__all"}
            onChange={(value) => setCategoryId(value === "__all" ? null : value)}
          />

          <TextInput
            className="storage-command__search"
            leftSection={<SearchIcon size={16} />}
            aria-label={t("filter.search")}
            placeholder={t("filter.search")}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />

          <Select
            aria-label={t("field.stock")}
            className="storage-command__stock"
            data={stockFilterOptions}
            value={stockFilter}
            onChange={(value) => setStockFilter((value as StorageStockFilter) ?? "all")}
          />

          <Group gap="xs" wrap="nowrap" className="storage-command__actions">
            <Button
              variant={batchDraft ? "light" : "default"}
              leftSection={<ClipboardIcon size={16} />}
              onClick={onStartBatch}
              disabled={!hasAnyItems}
            >
              {batchDraft
                ? t("batch.pendingItems", { count: batchEntryCount })
                : t("action.startBatch")}
            </Button>

            {canManageStock ? (
              <Button
                variant="default"
                leftSection={<ClipboardIcon size={16} />}
                onClick={() => onOpenTransaction(null, "intake")}
                disabled={!hasAnyItems}
              >
                {t("action.manualEntry")}
              </Button>
            ) : null}
            {canManageItems ? (
              <Button
                variant="default"
                leftSection={<PlusIcon size={16} />}
                onClick={() => onEditItem(null)}
              >
                {t("action.createItem")}
              </Button>
            ) : null}
          </Group>
        </div>

        <Group justify="space-between" gap="md" className="storage-inventory-meta">
          <Text size="sm" c="dimmed">
            {t("inventory.showing", { count: items.length })}
          </Text>
          {batchDraft ? (
            <Text size="sm" c="dimmed">{t("batch.selectHint")}</Text>
          ) : null}
        </Group>

        {/* 列名这一行是表头，钉在滚动区外面——跟着货品滚走的表头等于没有。 */}
        {items.length > 0 ? (
          <div className="storage-item-list__header" aria-hidden>
            <span>{t("field.item")}</span>
            <span>{t("field.stock")}</span>
            <span>{t("inventory.memberActions")}</span>
          </div>
        ) : null}

        <div className="storage-inventory-main__body">
        {itemsQuery.isLoading ? (
          <Stack gap={6} className="storage-loading-list">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height={68} radius="sm" className="storage-loading" />
            ))}
          </Stack>
        ) : null}

        {!itemsQuery.isLoading && items.length === 0 ? (
          <EmptyState
            title={t("empty.noItems")}
            actions={canManageItems ? (
              <Button leftSection={<PlusIcon size={16} />} onClick={() => onEditItem(null)}>
                {t("action.createItem")}
              </Button>
            ) : undefined}
          />
        ) : null}

        {items.length > 0 ? (
          <>
            <div className="storage-grid" aria-live="polite">
              {items.map((item) => (
                <StorageItemCard
                  key={item.id}
                  item={item}
                  category={storage.categories.find((category) => category.id === item.category_id)}
                  imageUrl={item.images[0] ? resolveStorageMediaUrl(item.images[0].r2_key) : undefined}
                  canEditItems={canManageItems}
                  canManageStock={canManageStock}
                  batch={batchDraft ? {
                    type: batchDraft.type,
                    quantity: batchDraft.quantities[item.id] ?? 0,
                    canManageStock,
                    limitReached: batchLimitReached,
                    onChange: (quantity) => onBatchQuantityChange(item, quantity),
                  } : undefined}
                  onOpen={onOpenItem}
                  onDeposit={(next) => onOpenTransaction(next, "intake")}
                  onWithdraw={(next) => onOpenTransaction(next, "distribute")}
                  onEdit={onEditItem}
                />
              ))}
            </div>
            {itemsQuery.hasNextPage ? (
              <Group justify="center" mt="md">
                <Button
                  variant="default"
                  onClick={() => void itemsQuery.fetchNextPage()}
                  loading={itemsQuery.isFetchingNextPage}
                >
                  {t("action.loadMore")}
                </Button>
              </Group>
            ) : null}
          </>
        ) : null}
        </div>
      </section>
    </div>
  );
}
