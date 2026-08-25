import type { Storage, StorageItem, StorageStockFilter } from "@guild/shared";
import { ClipboardIcon, PlusIcon, SearchIcon, XIcon } from "@portal/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@portal/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@portal/components/ui/radio-group";
import { Skeleton } from "@portal/components/ui/skeleton";
import { ContentFilterGroup, ContentFilterToolbar } from "@portal/components/shared/ContentFilterToolbar";
import { useDebouncedSearch } from "@portal/hooks/useDebouncedSearch";
import { useStorageItems } from "@portal/hooks/useStorage";
import { resolveMediaUrl } from "@portal/utils/media";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../shared/EmptyState";
import type { StorageBatchDraft } from "./StorageBatchPanel";
import { StorageItemCard } from "./StorageItemCard";

type MemberTransactionMode = "intake" | "distribute";

type StorageInventoryPanelProps = {
  storage: Storage;
  categoryId: string | null;
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
  categoryId,
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
  const { search, setSearch, debouncedSearch } = useDebouncedSearch();
  const [stockFilter, setStockFilter] = useState<StorageStockFilter>("all");
  const itemsQuery = useStorageItems({
    storageId: storage.id,
    categoryId,
    search: debouncedSearch,
    stock: stockFilter,
  });
  const items = itemsQuery.items;
  const itemsBlockingError = itemsQuery.isError && items.length === 0;
  const itemsRefreshError = itemsQuery.isError && items.length > 0;
  const stockFilterOptions = [
    { value: "all", label: t("filter.stockAll") },
    { value: "available", label: t("filter.available") },
    { value: "empty", label: t("filter.empty") },
    { value: "deposit", label: t("filter.depositEnabled") },
    { value: "withdraw", label: t("filter.withdrawEnabled") },
  ] as const;
  const batchEntryCount = batchDraft
    ? Object.values(batchDraft.quantities).filter((quantity) => quantity > 0).length
    : 0;
  const batchLimitReached = batchEntryCount >= 20;
  const activeFilterCount = Number(stockFilter !== "all");

  return (
    <div className="storage-inventory-shell">
      <section className="storage-inventory-main" aria-label={t("inventory.title")}>
        <ContentFilterToolbar
          className="storage-command"
          surface="bare"
          search={(
            <InputGroup className="storage-command__search">
              <InputGroupAddon>
                <SearchIcon size={16} aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label={t("filter.search")}
                placeholder={t("filter.search")}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
              {search ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label={t("common:action.clear")}
                    onClick={() => setSearch("")}
                    size="icon-xs"
                  >
                    <XIcon size={14} aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          )}
          filterControls={(
            <ContentFilterGroup label={t("field.stock")}>
              <RadioGroup
                value={stockFilter}
                onValueChange={(value) => setStockFilter(value as StorageStockFilter)}
                aria-label={t("field.stock")}
                className="storage-stock-filter"
              >
                {stockFilterOptions.map((option) => (
                  <label key={option.value} className="storage-radio-field">
                    <RadioGroupItem value={option.value} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </ContentFilterGroup>
          )}
          actions={(
            <div className="storage-command__actions">
              <Button
                variant={batchDraft ? "secondary" : "outline"}
                onClick={onStartBatch}
                disabled={!hasAnyItems}
              >
                <ClipboardIcon size={16} />
                {batchDraft ? t("batch.pendingItems", { count: batchEntryCount }) : t("action.startBatch")}
              </Button>
              {canManageStock ? (
                <Button
                  variant="outline"
                  onClick={() => onOpenTransaction(null, "intake")}
                  disabled={!hasAnyItems}
                >
                  <ClipboardIcon size={16} />
                  {t("action.manualEntry")}
                </Button>
              ) : null}
              {canManageItems && !itemsBlockingError ? (
                <Button variant="outline" onClick={() => onEditItem(null)}>
                  <PlusIcon size={16} />
                  {t("action.createItem")}
                </Button>
              ) : null}
            </div>
          )}
          filterLabel={t("common:filter.toggle")}
          activeFilterCount={activeFilterCount}
          resetLabel={t("common:filter.reset")}
          onReset={() => setStockFilter("all")}
        />

        {!itemsQuery.isLoading && !itemsBlockingError ? (
          <div className="storage-inventory-meta">
            <span>{t("inventory.showing", { count: items.length })}</span>
            {batchDraft ? <span>{t("batch.selectHint")}</span> : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="storage-item-list__header" aria-hidden="true">
            <span>{t("field.item")}</span>
            <span>{t("field.stock")}</span>
            <span>{t("inventory.memberActions")}</span>
          </div>
        ) : null}

        <div className="storage-inventory-main__body">
          {itemsQuery.isLoading ? (
            <div className="storage-loading-list">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="storage-loading storage-loading--row" />)}
            </div>
          ) : null}

          {!itemsQuery.isLoading && itemsBlockingError ? (
            <EmptyState
              status="error"
              title={t("common:loadError")}
              description={t("common:errors.connectionIssue")}
              actions={(
                <Button loading={itemsQuery.isFetching} onClick={() => void itemsQuery.refetch()}>
                  {t("common:action.retry")}
                </Button>
              )}
            />
          ) : null}

          {!itemsQuery.isLoading && !itemsQuery.isError && items.length === 0 ? (
            <EmptyState
              title={t("empty.noItems")}
              actions={canManageItems ? (
                <Button onClick={() => onEditItem(null)}>
                  <PlusIcon size={16} />
                  {t("action.createItem")}
                </Button>
              ) : undefined}
            />
          ) : null}

          {itemsRefreshError ? (
            <Alert variant="destructive" className="storage-inline-alert">
              <AlertTitle>{t("common:loadError")}</AlertTitle>
              <AlertDescription>
                <span>{t("common:errors.connectionIssue")}</span>
                <Button size="sm" variant="outline" loading={itemsQuery.isFetching} onClick={() => void itemsQuery.refetch()}>
                  {t("common:action.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {items.length > 0 ? (
            <>
              <div className="storage-grid" aria-live="polite">
                {items.map((item) => (
                  <StorageItemCard
                    key={item.id}
                    item={item}
                    category={storage.categories.find((category) => category.id === item.category_id)}
                    imageUrl={item.images[0] ? resolveMediaUrl(item.images[0].media_id) : undefined}
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
                <div className="storage-load-more">
                  <Button variant="outline" onClick={() => void itemsQuery.fetchNextPage()} loading={itemsQuery.isFetchingNextPage}>
                    {t("action.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
