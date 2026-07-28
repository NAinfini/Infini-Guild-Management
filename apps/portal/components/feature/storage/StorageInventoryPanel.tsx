import type { Storage, StorageItem } from "@guild/shared";
import {
  Button,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  TextInput,
} from "@mantine/core";
import { ClipboardIcon, PlusIcon, SearchIcon } from "@portal/components/icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStorageItems } from "../../../hooks/useStorage";
import { resolveStorageMediaUrl } from "../../../utils/media";
import { PageLayout } from "../../layout/PageLayout";
import { EmptyState } from "../../shared/EmptyState";
import type { StorageBatchDraft } from "./StorageBatchPanel";
import { StorageItemCard } from "./StorageItemCard";

type StockFilter = "all" | "available" | "empty" | "deposit" | "withdraw";
type MemberTransactionMode = "intake" | "distribute";

type StorageInventoryPanelProps = {
  storage: Storage;
  canManageItems: boolean;
  canManageStock: boolean;
  hasAnyItems: boolean;
  batchDraft?: StorageBatchDraft;
  onStartBatch: () => void;
  onBatchQuantityChange: (itemId: string, quantity: number) => void;
  onOpenItem: (item: StorageItem) => void;
  onEditItem: (item: StorageItem | null) => void;
  onOpenTransaction: (item: StorageItem | null, mode: MemberTransactionMode) => void;
};

function filterItems(items: StorageItem[], stockFilter: StockFilter): StorageItem[] {
  if (stockFilter === "available") return items.filter((item) => item.quantity > 0);
  if (stockFilter === "empty") return items.filter((item) => item.quantity === 0);
  if (stockFilter === "deposit") return items.filter((item) => item.allow_member_deposit);
  if (stockFilter === "withdraw") return items.filter((item) => item.allow_member_withdraw);
  return items;
}

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
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const itemsQuery = useStorageItems(storage.id, categoryId, search);
  const items = useMemo(
    () => filterItems(
      [...(itemsQuery.data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      stockFilter,
    ),
    [itemsQuery.data?.data, stockFilter],
  );
  const stockFilterOptions = [
    { value: "all", label: t("filter.stockAll") },
    { value: "available", label: t("filter.available") },
    { value: "empty", label: t("filter.empty") },
    { value: "deposit", label: t("filter.depositEnabled") },
    { value: "withdraw", label: t("filter.withdrawEnabled") },
  ];
  const batchEntryCount = batchDraft
    ? Object.values(batchDraft.quantities).filter((quantity) => quantity > 0).length
    : 0;
  const batchLimitReached = batchEntryCount >= 20;

  return (
    <Stack gap="md">
      <PageLayout.Section className="storage-toolbar-section">
        <div className="storage-command">
          <div className="storage-command__row">
            <div className="storage-command__primary">
              <SegmentedControl
                size="xs"
                className="storage-command__categories"
                aria-label={t("filter.category")}
                value={categoryId ?? "__all"}
                onChange={(value) => setCategoryId(value === "__all" ? null : value)}
                data={[
                  { value: "__all", label: t("filter.all") },
                  ...storage.categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
              />
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
            {hasAnyItems || canManageStock || canManageItems ? (
              <Group gap={8} className="storage-command__actions">
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
                    leftSection={<PlusIcon size={16} />}
                    onClick={() => onEditItem(null)}
                  >
                    {t("action.createItem")}
                  </Button>
                ) : null}
              </Group>
            ) : null}
          </div>
        </div>
      </PageLayout.Section>

      {itemsQuery.isLoading ? (
        <Skeleton height={220} radius="md" className="storage-loading" />
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
        <PageLayout.Section className="storage-items-section">
          <div className="storage-grid" aria-live="polite">
            {items.map((item) => (
              <StorageItemCard
                key={item.id}
                item={item}
                category={storage.categories.find((category) => category.id === item.category_id)}
                imageUrl={item.images[0] ? resolveStorageMediaUrl(item.images[0].r2_key) : undefined}
                canEditItems={canManageItems}
                batch={batchDraft ? {
                  type: batchDraft.type,
                  quantity: batchDraft.quantities[item.id] ?? 0,
                  canManageStock,
                  limitReached: batchLimitReached,
                  onChange: (quantity) => onBatchQuantityChange(item.id, quantity),
                } : undefined}
                onOpen={onOpenItem}
                onDeposit={(next) => onOpenTransaction(next, "intake")}
                onWithdraw={(next) => onOpenTransaction(next, "distribute")}
                onEdit={onEditItem}
              />
            ))}
          </div>
        </PageLayout.Section>
      ) : null}
    </Stack>
  );
}
