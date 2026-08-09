import { LIMITS, type CreateStorageTransactionPayload, type StorageItem, type User } from "@guild/shared";
import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { ArrowRightIcon } from "@portal/components/icons";
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
  const initializedSessionRef = useRef<string | null>(null);

  const selectedItem = itemId
    ? items.find((item) => item.id === itemId) ?? selectedItemSnapshot
    : null;
  const selectedUser = users.find(({ user }) => user.id === recipientUserId)?.user ?? null;
  const itemOptions = useMemo(
    () => items.map((item) => ({ value: item.id, label: `${item.name} (${item.quantity})` })),
    [items],
  );
  const userOptions = useMemo(
    () => users.map(({ user }) => ({ value: user.id, label: user.username })),
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
    ? "storage-transaction-modal__summary--deposit"
    : "storage-transaction-modal__summary--withdraw";
  const toneColor = type === "adjust" ? "orange" : isPositiveChange ? "green" : "blue";
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
      return;
    }
    if (initializedSessionRef.current === sessionKey) return;
    initializedSessionRef.current = sessionKey;
    const nextType = canManageStock ? initialMode : initialMode === "adjust" ? "intake" : initialMode;
    const nextItem = initialItem;
    setItemId(nextItem?.id ?? null);
    setSelectedItemSnapshot(nextItem);
    setRecipientUserId(null);
    setType(nextType);
    setQuantity(nextType === "adjust" ? nextItem?.quantity ?? 0 : 1);
    setNote("");
  }, [canManageStock, initialItem, initialMode, sessionKey]);

  const handleTypeChange = (value: string) => {
    const nextType = value as TransactionMode;
    setType(nextType);
    setQuantity(nextType === "adjust" ? currentStock : 1);
  };

  const handleSubmit = () => {
    if (!selectedItem || !canSubmit) return;
    const trimmedNote = note.trim() || null;
    if (type === "adjust") {
      onSubmit(selectedItem.id, {
        type,
        target_quantity: safeQuantity,
        note: trimmedNote,
      });
      return;
    }
    onSubmit(selectedItem.id, {
      type,
      quantity: safeQuantity,
      recipient_user_id: effectiveRecipientId,
      note: trimmedNote,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        canManageStock && !initialItem
          ? t("adminEntry.title")
          : selectedItem
            ? `${actionTitle}: ${selectedItem.name}`
            : actionTitle
      }
      size={canManageStock ? 520 : 420}
      centered
      styles={{
        inner: { paddingInline: "var(--space-sm)" },
        content: { maxWidth: "calc(100vw - 16px)" },
        body: { minWidth: 0 },
      }}
      classNames={{
        content: `storage-modal-content ${canManageStock ? "storage-admin-transaction-shell" : "storage-transaction-shell"}`,
        header: "storage-modal-header",
        body: "storage-modal-body",
      }}
    >
      <Stack
        gap="md"
        style={{ minWidth: 0, maxWidth: "100%" }}
        className={`storage-transaction-modal ${canManageStock ? "storage-transaction-modal--admin" : "storage-transaction-modal--simple"} ${type === "adjust" ? "storage-transaction-modal--adjust" : ""}`}
      >
        {canManageStock ? (
          <div className="storage-admin-transaction-type">
            <Text size="sm" fw={700}>{t("field.type")}</Text>
            <SegmentedControl
              fullWidth
              /*
               * SegmentedControl 没有像 Button/Input 那样的高度变量可以在
               * ThemeProvider 里桥接，所以这一处仍要显式给高度——但取值走令牌，
               * 别再写死 44：细指针下 --control-height-regular 是 36px，粗指针下
               * 才回到 44px。写死 44 的结果是桌面上这排分段控件比同一个弹窗里
               * 的输入框和按钮高出 8px。
               */
              styles={{
                label: {
                  minHeight: "var(--control-height-regular)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                },
              }}
              data={[
                { value: "intake", label: t("tx.intake") },
                { value: "distribute", label: t("tx.distribute") },
                { value: "adjust", label: t("tx.adjust") },
              ]}
              value={type}
              onChange={handleTypeChange}
            />
          </div>
        ) : null}

        {selectedItem ? (
          <div
            className={`storage-transaction-modal__summary ${toneClass} ${type === "adjust" ? "storage-transaction-modal__summary--adjust" : ""}`}
            style={{ minWidth: 0 }}
          >
            <div className="storage-transaction-modal__item-line">
              <Text fw={900} lineClamp={1}>{selectedItem.name}</Text>
              <Badge variant="light" color={toneColor}>
                {stockDelta > 0 ? "+" : ""}{stockDelta}
              </Badge>
            </div>
            <div className="storage-transaction-flow">
              <div>
                <Text size="xs" c="dimmed">{t("field.currentStock")}</Text>
                <Text fw={900} className="storage-transaction-flow__value">{currentStock}</Text>
              </div>
              <span className={`storage-transaction-flow__arrow ${isPositiveChange ? "storage-transaction-flow__arrow--deposit" : "storage-transaction-flow__arrow--withdraw"}`}>
                <ArrowRightIcon size={18} />
              </span>
              <div>
                <Text size="xs" c="dimmed">{t("field.stockAfter")}</Text>
                <Text fw={900} className="storage-transaction-flow__value">{projectedStock}</Text>
              </div>
            </div>
          </div>
        ) : (
          <Text size="sm" c="dimmed">{t("adminEntry.chooseItemHint")}</Text>
        )}

        <div
          className={`storage-admin-transaction-grid ${type === "adjust" ? "storage-admin-transaction-grid--adjust" : ""}`}
          style={{ minWidth: 0 }}
        >
          {canManageStock ? (
            <Stack gap={6}>
              <Select
                label={t("field.item")}
                data={itemOptions}
                value={itemId}
                onChange={(value) => {
                  setItemId(value);
                  setSelectedItemSnapshot(
                    items.find((item) => item.id === value) ?? null,
                  );
                  if (type === "adjust") {
                    setQuantity(items.find((item) => item.id === value)?.quantity ?? 0);
                  }
                }}
                searchable
                searchValue={itemSearch}
                onSearchChange={onItemSearchChange}
                nothingFoundMessage={t("empty.noItems")}
              />
              {itemsHasMore ? (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  loading={itemsLoadingMore}
                  onClick={onLoadMoreItems}
                >
                  {t("action.loadMore")}
                </Button>
              ) : null}
            </Stack>
          ) : null}
          {canManageStock && showsRecipient ? (
            <Select
              label={type === "intake" ? t("field.memberOptional") : t("field.member")}
              data={userOptions}
              value={recipientUserId}
              onChange={setRecipientUserId}
              searchable
              nothingFoundMessage={t("empty.noUsers")}
            />
          ) : null}
          <NumberInput
            label={type === "adjust" ? t("field.targetStock") : t("field.quantity")}
            min={type === "adjust" ? 0 : 1}
            max={
              type === "distribute" && selectedItem
                ? Math.min(
                    selectedItem.quantity,
                    LIMITS.content.storageTransactionQuantity.max,
                  )
                : LIMITS.content.storageTransactionQuantity.max
            }
            value={quantity}
            onChange={setQuantity}
            error={quantityError}
          />
        </div>

        {canManageStock && selectedItem && type === "adjust" ? (
          <Text size="sm" className="storage-admin-transaction-summary">
            {t("adminEntry.adjustSummary", { quantity: projectedStock, item: selectedItem.name })}
          </Text>
        ) : null}
        {canManageStock && selectedItem && selectedUser && type !== "adjust" ? (
          <Text size="sm" className="storage-admin-transaction-summary">
            {t("adminEntry.summary", {
              member: selectedUser.username,
              action: type === "intake" ? t("tx.intake") : t("tx.distribute"),
              quantity: safeQuantity,
              item: selectedItem.name,
            })}
          </Text>
        ) : null}

        <Textarea
          autosize={!canManageStock}
          label={t("field.note")}
          minRows={canManageStock ? 3 : 2}
          maxRows={4}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        <Group justify="flex-end" className="storage-transaction-modal__actions">
          <Button variant="default" onClick={onClose}>
            {t("common:action.cancel")}
          </Button>
          <Button
            color={toneColor}
            onClick={handleSubmit}
            loading={isSaving}
            disabled={!canSubmit}
          >
            {canManageStock
              ? t("action.submit")
              : type === "intake"
                ? t("action.submitDeposit")
                : t("action.submitWithdraw")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
