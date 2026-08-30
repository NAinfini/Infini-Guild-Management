import { LIMITS, type CreateStorageTransactionPayload, type StorageItem, type User } from "@guild/shared";
import { ArrowRightIcon, PhotoOffIcon, XIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@portal/components/ui/select";
import { Textarea } from "@portal/components/ui/textarea";
import { resolveMediaUrl } from "@portal/utils/media";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type TransactionMode = CreateStorageTransactionPayload["type"];
type UserOption = { user: User };

type StorageTransactionModalProps = {
  opened: boolean;
  items: StorageItem[];
  users: UserOption[];
  initialItem: StorageItem | null;
  initialMode: TransactionMode;
  canManageStock: boolean;
  itemsHasMore?: boolean;
  itemsLoadingMore?: boolean;
  itemSearch?: string;
  defaultRecipientUserId?: string;
  isSaving: boolean;
  onItemSearchChange?: (value: string) => void;
  onLoadMoreItems?: () => void;
  onClose: () => void;
  onSubmit: (itemId: string, payload: CreateStorageTransactionPayload) => void;
};

function toNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const normalized = String(value).trim();
  return normalized ? Number(normalized) : Number.NaN;
}

export function StorageTransactionModal({
  opened,
  items,
  users,
  initialItem,
  initialMode,
  canManageStock,
  itemsHasMore = false,
  itemsLoadingMore = false,
  itemSearch,
  defaultRecipientUserId,
  isSaving,
  onItemSearchChange,
  onLoadMoreItems,
  onClose,
  onSubmit,
}: StorageTransactionModalProps) {
  const { t } = useTranslation("storage");
  const [itemId, setItemId] = useState<string | null>(null);
  const [selectedItemSnapshot, setSelectedItemSnapshot] = useState<StorageItem | null>(null);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(null);
  const [type, setType] = useState<TransactionMode>("intake");
  const [quantity, setQuantity] = useState<number | string>(1);
  const [note, setNote] = useState("");
  const [brokenPreviewId, setBrokenPreviewId] = useState<string | null>(null);
  const initializedSessionRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const selectedItem = itemId
    ? items.find((item) => item.id === itemId) ?? selectedItemSnapshot
    : null;
  const selectedUser = users.find(({ user }) => user.id === recipientUserId)?.user ?? null;
  const itemOptions = useMemo(
    () => items.map((item) => ({ value: item.id, label: `${item.name} (${item.quantity})` })),
    [items],
  );
  const userOptions = useMemo(
    () => users.map(({ user }) => ({ value: user.id, label: user.display_name })),
    [users],
  );
  const numericQuantity = toNumber(quantity);
  const hasValidQuantity = Number.isInteger(numericQuantity);
  const safeQuantity = hasValidQuantity ? numericQuantity : 0;
  const withinQuantityLimit = safeQuantity <= LIMITS.content.storageTransactionQuantity.max;
  const currentStock = selectedItem?.quantity ?? 0;
  const projectedStock = type === "adjust"
    ? safeQuantity
    : Math.max(0, currentStock + (type === "intake" ? safeQuantity : -safeQuantity));
  const stockDelta = type === "adjust"
    ? projectedStock - currentStock
    : type === "intake"
      ? safeQuantity
      : -safeQuantity;
  const isPositiveChange = stockDelta >= 0;
  const showsRecipient = type !== "adjust";
  const requiresRecipient = type === "distribute";
  const effectiveRecipientId = canManageStock
    ? selectedUser?.id ?? null
    : defaultRecipientUserId ?? null;
  const exceedsStock = type === "distribute" && safeQuantity > currentStock;
  const noChange = type === "adjust" && stockDelta === 0;
  const memberOperationAllowed = canManageStock
    || (type === "intake" && Boolean(selectedItem?.allow_member_deposit))
    || (type === "distribute" && Boolean(selectedItem?.allow_member_withdraw));
  const canSubmit = Boolean(selectedItem)
    && (!requiresRecipient || Boolean(effectiveRecipientId))
    && hasValidQuantity
    && safeQuantity >= (type === "adjust" ? 0 : 1)
    && withinQuantityLimit
    && !exceedsStock
    && !noChange
    && memberOperationAllowed;
  const toneClass = isPositiveChange
    ? "storage-transaction-modal__context--deposit"
    : "storage-transaction-modal__context--withdraw";
  const actionTitle = type === "intake"
    ? t("action.deposit")
    : type === "distribute"
      ? t("action.withdraw")
      : t("tx.adjust");
  const quantityError = !hasValidQuantity
    ? t("validation.quantityInteger")
    : !withinQuantityLimit
      ? t("validation.quantityLimit")
      : exceedsStock
        ? t("validation.insufficientStock")
        : noChange
          ? t("validation.noStockChange")
          : null;

  const sessionKey = opened
    ? `${initialItem?.id ?? "manual"}:${initialMode}:${canManageStock ? "manager" : "member"}`
    : null;

  useEffect(() => {
    if (!sessionKey) {
      initializedSessionRef.current = null;
      idempotencyKeyRef.current = null;
      return;
    }
    if (initializedSessionRef.current === sessionKey) return;
    initializedSessionRef.current = sessionKey;
    idempotencyKeyRef.current = crypto.randomUUID();
    const nextType = canManageStock ? initialMode : initialMode === "adjust" ? "intake" : initialMode;
    const nextItem = initialItem;
    setItemId(nextItem?.id ?? null);
    setSelectedItemSnapshot(nextItem);
    setRecipientUserId(null);
    setType(nextType);
    setQuantity(nextType === "adjust" ? nextItem?.quantity ?? 0 : 1);
    setNote("");
    setBrokenPreviewId(null);
  }, [canManageStock, initialItem, initialMode, sessionKey]);

  const handleTypeChange = (nextType: TransactionMode) => {
    if (nextType === type) return;
    idempotencyKeyRef.current = crypto.randomUUID();
    setType(nextType);
    setQuantity(nextType === "adjust" ? currentStock : 1);
  };

  const handleSubmit = () => {
    if (!selectedItem || !canSubmit) return;
    const idempotencyKey = idempotencyKeyRef.current;
    if (!idempotencyKey) return;
    const trimmedNote = note.trim() || null;
    if (type === "adjust") {
      onSubmit(selectedItem.id, {
        idempotency_key: idempotencyKey,
        type,
        target_quantity: safeQuantity,
        note: trimmedNote,
      });
      return;
    }
    onSubmit(selectedItem.id, {
      idempotency_key: idempotencyKey,
      type,
      quantity: safeQuantity,
      recipient_user_id: effectiveRecipientId,
      note: trimmedNote,
    });
  };

  return (
    <Dialog open={opened} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className={`storage-modal-content ${canManageStock ? "storage-admin-transaction-shell" : "storage-transaction-shell"}`}
        showCloseButton={false}
      >
        <DialogHeader className="storage-modal-header">
          <div className="storage-overlay-heading">
            <DialogTitle>
              {canManageStock && !initialItem
                ? t("adminEntry.title")
                : selectedItem
                  ? `${actionTitle}: ${selectedItem.name}`
                  : actionTitle}
            </DialogTitle>
            <DialogClose aria-label={t("common:action.close")} render={<Button size="icon-sm" variant="ghost" />}>
              <XIcon size={16} />
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="storage-modal-body storage-transaction-modal__body">
          <section
            className={`storage-transaction-modal__context ${toneClass} ${type === "adjust" ? "storage-transaction-modal__context--adjust" : ""}`}
            aria-live="polite"
          >
            {selectedItem ? (
              <>
                <div className="storage-transaction-modal__preview">
                  {selectedItem.images[0] && brokenPreviewId !== selectedItem.images[0].media_id ? (
                    <img
                      src={resolveMediaUrl(selectedItem.images[0].media_id)}
                      alt={selectedItem.name}
                      onError={() => setBrokenPreviewId(selectedItem.images[0]?.media_id ?? null)}
                    />
                  ) : (
                    <PhotoOffIcon size={28} aria-hidden="true" />
                  )}
                </div>
                <div className="storage-transaction-modal__context-details">
                  <div className="storage-transaction-modal__item-line">
                    <div>
                      <strong>{selectedItem.name}</strong>
                      <span>{t(`rarity.${selectedItem.rarity}`)}{selectedItem.unit ? ` · ${selectedItem.unit}` : ""}</span>
                    </div>
                    <Badge variant="secondary" className="storage-transaction-modal__delta-badge">
                      {stockDelta > 0 ? "+" : ""}{stockDelta}
                    </Badge>
                  </div>
                  <div className="storage-transaction-flow">
                    <div>
                      <span className="storage-meta-label">{t("field.currentStock")}</span>
                      <strong className="storage-transaction-flow__value">{currentStock}</strong>
                    </div>
                    <span className={`storage-transaction-flow__arrow ${isPositiveChange ? "storage-transaction-flow__arrow--deposit" : "storage-transaction-flow__arrow--withdraw"}`}>
                      <ArrowRightIcon size={18} />
                    </span>
                    <div>
                      <span className="storage-meta-label">{t("field.stockAfter")}</span>
                      <strong className="storage-transaction-flow__value">{projectedStock}</strong>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="storage-transaction-modal__empty-context">
                <PhotoOffIcon size={30} aria-hidden="true" />
                <p>{t("adminEntry.chooseItemHint")}</p>
              </div>
            )}
          </section>

          <div className="storage-transaction-modal__form">
            {canManageStock ? (
              <div className="storage-admin-transaction-type" role="group" aria-label={t("field.type")}>
                <span className="storage-field__label">{t("field.type")}</span>
                <div className="storage-admin-transaction-type__options">
                  {(["intake", "distribute", "adjust"] as const).map((nextType) => (
                    <Button
                      key={nextType}
                      size="sm"
                      variant={type === nextType ? "default" : "ghost"}
                      aria-pressed={type === nextType}
                      onClick={() => handleTypeChange(nextType)}
                    >
                      {t(`tx.${nextType}`)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={`storage-admin-transaction-grid ${type === "adjust" ? "storage-admin-transaction-grid--adjust" : ""}`}>
              {canManageStock && !initialItem ? (
                <>
                  {onItemSearchChange ? (
                    <div className="storage-field storage-admin-transaction-grid__wide">
                      <Label htmlFor="storage-transaction-search">{t("filter.search")}</Label>
                      <Input
                        id="storage-transaction-search"
                        type="search"
                        value={itemSearch ?? ""}
                        onChange={(event) => onItemSearchChange(event.currentTarget.value)}
                      />
                    </div>
                  ) : null}
                  <div className="storage-field storage-admin-transaction-grid__wide">
                    <Label>{t("field.item")}</Label>
                    <Select
                      value={itemId}
                      items={itemOptions}
                      onValueChange={(value) => {
                        if (!value || value === itemId) return;
                        const nextItem = items.find((item) => item.id === value);
                        idempotencyKeyRef.current = crypto.randomUUID();
                        setItemId(value);
                        setBrokenPreviewId(null);
                        if (nextItem) {
                          setSelectedItemSnapshot(nextItem);
                          if (type === "adjust") setQuantity(nextItem.quantity);
                        }
                      }}
                    >
                      <SelectTrigger aria-label={t("field.item")} className="storage-field__control">
                        <SelectValue placeholder={itemOptions.length ? t("field.selectItem") : t("empty.noItems")} />
                      </SelectTrigger>
                      <SelectContent>
                        {itemOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {itemsHasMore ? (
                      <Button size="sm" variant="ghost" loading={itemsLoadingMore} onClick={onLoadMoreItems}>
                        {t("action.loadMore")}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
              {canManageStock && showsRecipient ? (
                <div className="storage-field">
                  <Label>{type === "intake" ? t("field.memberOptional") : t("field.member")}</Label>
                  <Select
                    value={recipientUserId}
                    items={userOptions}
                    onValueChange={(value) => {
                      const nextRecipientUserId = value ?? null;
                      if (nextRecipientUserId === recipientUserId) return;
                      idempotencyKeyRef.current = crypto.randomUUID();
                      setRecipientUserId(nextRecipientUserId);
                    }}
                  >
                    <SelectTrigger
                      aria-label={type === "intake" ? t("field.memberOptional") : t("field.member")}
                      className="storage-field__control"
                    >
                      <SelectValue
                        placeholder={userOptions.length === 0
                          ? t("empty.noUsers")
                          : type === "intake"
                            ? t("field.noMember")
                            : t("field.selectMember")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {userOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="storage-field">
                <Label htmlFor="storage-transaction-quantity">
                  {type === "adjust" ? t("field.targetStock") : t("field.quantity")}
                </Label>
                <Input
                  id="storage-transaction-quantity"
                  inputMode="numeric"
                  value={String(quantity)}
                  onChange={(event) => {
                    if (event.currentTarget.value === String(quantity)) return;
                    idempotencyKeyRef.current = crypto.randomUUID();
                    setQuantity(event.currentTarget.value);
                  }}
                  aria-invalid={Boolean(quantityError)}
                />
                {quantityError ? <span className="storage-field__error" role="alert">{quantityError}</span> : null}
              </div>
            </div>

            <div className="storage-field">
              <Label htmlFor="storage-transaction-note">{t("field.note")}</Label>
              <Textarea
                id="storage-transaction-note"
                rows={canManageStock ? 3 : 2}
                value={note}
                onChange={(event) => {
                  if (event.currentTarget.value === note) return;
                  idempotencyKeyRef.current = crypto.randomUUID();
                  setNote(event.currentTarget.value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="storage-transaction-modal__actions">
          <Button variant="outline" onClick={onClose}>{t("common:action.cancel")}</Button>
          <Button onClick={handleSubmit} loading={isSaving} disabled={!canSubmit}>
            {canManageStock
              ? t("action.submit")
              : type === "intake"
                ? t("action.submitDeposit")
                : t("action.submitWithdraw")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
