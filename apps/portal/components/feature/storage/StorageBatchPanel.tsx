import type { MemberDirectoryEntry } from "@guild/shared";
import { TrashIcon, XIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import type { MemberDirectoryLoadError } from "@portal/hooks/data/useMemberDirectory";
import { RetryableLoadError } from "@portal/components/shared/RetryableLoadError";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import { Label } from "@portal/components/ui/label";
import { Input } from "@portal/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@portal/components/ui/sheet";
import { Textarea } from "@portal/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StorageBatchDirection, StorageBatchDraft } from "./storage-batch-draft";

type UserOption = Pick<MemberDirectoryEntry, "user">;

type StorageBatchPanelProps = {
  draft: StorageBatchDraft;
  users: UserOption[];
  userSearch?: string;
  usersHasMore?: boolean;
  usersLoadingMore?: boolean;
  usersLoading?: boolean;
  userLoadError?: MemberDirectoryLoadError | null;
  currentUsername?: string;
  canManageStock: boolean;
  isSaving: boolean;
  onTypeChange: (type: StorageBatchDirection) => void;
  onRecipientChange: (userId: string | null) => void;
  onUserSearchChange?: (value: string) => void;
  onLoadMoreUsers?: () => void;
  onNoteChange: (note: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onClear: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function StorageBatchPanel({
  draft,
  users,
  userSearch = "",
  usersHasMore = false,
  usersLoadingMore = false,
  usersLoading = false,
  userLoadError = null,
  currentUsername,
  canManageStock,
  isSaving,
  onTypeChange,
  onRecipientChange,
  onUserSearchChange,
  onLoadMoreUsers,
  onNoteChange,
  onQuantityChange,
  onClear,
  onClose,
  onSubmit,
}: StorageBatchPanelProps) {
  const { t } = useTranslation("storage");
  const isMobile = useMediaQuery("(max-width: 40em)");
  const [reviewOpened, setReviewOpened] = useState(false);
  const itemsById = useMemo(
    () => new Map(Object.entries(draft.itemSnapshots)),
    [draft.itemSnapshots],
  );
  const selectedEntries = Object.entries(draft.quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({
      itemId,
      quantity,
      item: itemsById.get(itemId),
    }))
    .sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId));
  const totalQuantity = selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const userOptions = users.map(({ user }) => ({ value: user.id, label: user.display_name }));
  const selectionInvalid = selectedEntries.some(({ item, quantity }) => (
    !item
    || (draft.type === "distribute" && quantity > item.quantity)
    || (!canManageStock && draft.type === "intake" && !item.allow_member_deposit)
    || (!canManageStock && draft.type === "distribute" && !item.allow_member_withdraw)
  ));
  const canSubmit = selectedEntries.length > 0
    && Boolean(draft.recipientUserId)
    && !selectionInvalid
    && !isSaving;

  useEffect(() => {
    if (selectedEntries.length === 0) setReviewOpened(false);
  }, [selectedEntries.length]);

  const reviewBody = (
    <div className="storage-batch-review">
      <div className="storage-batch-review__summary">
        <div>
          <span className="storage-meta-label">{t("field.direction")}</span>
          <strong>{draft.type === "intake" ? t("tx.intake") : t("tx.distribute")}</strong>
        </div>
        <div className="storage-batch-review__metrics">
          <div>
            <span className="storage-meta-label">{t("batch.selectedItems")}</span>
            <strong>{selectedEntries.length}</strong>
          </div>
          <div>
            <span className="storage-meta-label">{t("batch.totalUnits")}</span>
            <strong>{totalQuantity}</strong>
          </div>
        </div>
      </div>

      {canManageStock ? (
        <div className="storage-field">
          <Label>{t("field.member")}</Label>
          {onUserSearchChange ? (
            <Input
              type="search"
              value={userSearch}
              aria-label={t("filter.searchMembers")}
              placeholder={t("filter.searchMembers")}
              onChange={(event) => onUserSearchChange(event.currentTarget.value)}
              disabled={isSaving}
            />
          ) : null}
          {userLoadError ? (
            <RetryableLoadError
              pending={userLoadError.retrying}
              onRetry={() => { void userLoadError.retry(); }}
            />
          ) : null}
          {usersLoading && userOptions.length === 0 ? (
            <LoadingIndicator />
          ) : userLoadError && userOptions.length === 0 ? null : (
            <Select
              value={draft.recipientUserId ?? undefined}
              items={userOptions}
              onValueChange={(value) => onRecipientChange(value ?? null)}
              disabled={isSaving}
            >
              <SelectTrigger aria-label={t("field.member")} className="storage-field__control">
                <SelectValue placeholder={t("empty.noUsers")} />
              </SelectTrigger>
              <SelectContent>
                {userOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {usersHasMore && onLoadMoreUsers && !userLoadError ? (
            <Button size="sm" variant="ghost" loading={usersLoadingMore} onClick={onLoadMoreUsers}>
              {t("action.loadMore")}
            </Button>
          ) : null}
          {!draft.recipientUserId ? (
            <span className="storage-field__error" role="alert">{t("validation.recipientRequired")}</span>
          ) : null}
        </div>
      ) : (
        <div className="storage-batch-review__member">
          <span className="storage-meta-label">{t("field.member")}</span>
          <Badge variant="secondary">{currentUsername ?? t("batch.currentMember")}</Badge>
        </div>
      )}

      <section className="storage-batch-review__selection" aria-labelledby="storage-batch-selection-heading">
        <div className="storage-batch-review__selection-heading">
          <strong id="storage-batch-selection-heading">{t("batch.itemsToApply")}</strong>
          <Button
            size="sm"
            variant="destructive"
            onClick={onClear}
            disabled={selectedEntries.length === 0 || isSaving}
          >
            {t("action.clearBatch")}
          </Button>
        </div>
        <div className="storage-batch-review__items">
          {selectedEntries.map(({ itemId, item, quantity }) => (
            <div key={itemId} className="storage-batch-review__item">
              <Tooltip>
                <TooltipTrigger render={<span className="storage-batch-review__item-name" tabIndex={0} />}>
                  {item?.name ?? itemId}
                </TooltipTrigger>
                <TooltipContent>{item?.name ?? itemId}</TooltipContent>
              </Tooltip>
              <div className="storage-batch-review__item-actions">
                <Badge variant="secondary">×{quantity}</Badge>
                <Button
                  size="icon-sm"
                  variant="destructive"
                  aria-label={t("action.removeBatchItem", { item: item?.name ?? itemId })}
                  onClick={() => onQuantityChange(itemId, 0)}
                  disabled={isSaving}
                >
                  <TrashIcon size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {selectionInvalid ? (
        <p className="storage-batch-review__error" role="alert">{t("batch.selectionChanged")}</p>
      ) : null}

      <div className="storage-field">
        <Label htmlFor="storage-batch-note">{t("field.note")}</Label>
        <Textarea
          id="storage-batch-note"
          value={draft.note}
          onChange={(event) => onNoteChange(event.currentTarget.value)}
          rows={3}
          disabled={isSaving}
        />
      </div>

      <Button className="storage-batch-review__submit" onClick={onSubmit} loading={isSaving} disabled={!canSubmit}>
        {t("action.submitBatch", { count: selectedEntries.length })}
      </Button>
    </div>
  );

  return (
    <aside id="storage-batch-panel" className="storage-batch-panel" aria-label={t("batch.title")}>
      <section className="storage-batch-bar">
        <div className="storage-batch-bar__identity">
          <strong>{t("batch.title")}</strong>
          <span>{t("batch.selectHint")}</span>
        </div>

        <div className="storage-batch-bar__direction" role="group" aria-label={t("field.direction")}>
          <Button
            size="sm"
            variant={draft.type === "intake" ? "default" : "outline"}
            aria-pressed={draft.type === "intake"}
            onClick={() => onTypeChange("intake")}
          >
            {t("tx.intake")}
          </Button>
          <Button
            size="sm"
            variant={draft.type === "distribute" ? "default" : "outline"}
            aria-pressed={draft.type === "distribute"}
            onClick={() => onTypeChange("distribute")}
          >
            {t("tx.distribute")}
          </Button>
        </div>

        <div className="storage-batch-bar__summary">
          <div>
            <span>{t("batch.selectedItems")}</span>
            <strong className="storage-batch-bar__value">{selectedEntries.length}</strong>
          </div>
          <div>
            <span>{t("batch.totalUnits")}</span>
            <strong className="storage-batch-bar__value">{totalQuantity}</strong>
          </div>
        </div>

        <div className="storage-batch-bar__actions">
          <Button variant="outline" onClick={() => setReviewOpened(true)} disabled={selectedEntries.length === 0}>
            {t("action.reviewBatch")}
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t("action.closeBatch")}
            onClick={onClose}
            disabled={isSaving}
          >
            <XIcon size={18} />
          </Button>
        </div>
      </section>

      {isMobile ? (
        <Drawer open={reviewOpened} onOpenChange={setReviewOpened} swipeDirection="down" showSwipeHandle>
          <DrawerContent className="storage-batch-drawer">
            <DrawerHeader className="storage-modal-header">
              <div className="storage-overlay-heading">
                <DrawerTitle>{t("batch.reviewTitle")}</DrawerTitle>
                <DrawerClose
                  aria-label={t("common:action.close")}
                  render={<Button size="icon-sm" variant="ghost" />}
                >
                  <XIcon size={16} />
                </DrawerClose>
              </div>
            </DrawerHeader>
            <div className="storage-modal-body">{reviewBody}</div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={reviewOpened} onOpenChange={setReviewOpened}>
          <SheetContent side="right" className="storage-batch-drawer" showCloseButton={false}>
            <SheetHeader className="storage-modal-header">
              <div className="storage-overlay-heading">
                <SheetTitle>{t("batch.reviewTitle")}</SheetTitle>
                <SheetClose
                  aria-label={t("common:action.close")}
                  render={<Button size="icon-sm" variant="ghost" />}
                >
                  <XIcon size={16} />
                </SheetClose>
              </div>
            </SheetHeader>
            <div className="storage-modal-body">{reviewBody}</div>
          </SheetContent>
        </Sheet>
      )}
    </aside>
  );
}
