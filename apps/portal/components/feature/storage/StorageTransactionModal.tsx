import type { CreateStorageTransactionPayload, StorageItem, User } from "@guild/shared";
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
import { useEffect, useMemo, useState } from "react";
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
  defaultRecipientUserId?: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (itemId: string, payload: CreateStorageTransactionPayload) => void;
};

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(String(value), 10);
}

export function StorageTransactionModal({
  opened,
  items,
  users,
  initialItem,
  initialMode,
  canManageStock,
  defaultRecipientUserId,
  isSaving,
  onClose,
  onSubmit,
}: StorageTransactionModalProps) {
  const { t } = useTranslation("storage");
  const [itemId, setItemId] = useState<string | null>(null);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(null);
  const [type, setType] = useState<TransactionMode>("intake");
  const [quantity, setQuantity] = useState<number | string>(1);
  const [note, setNote] = useState("");

  const selectedItem = items.find((item) => item.id === itemId) ?? initialItem;
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
  const hasValidQuantity = Number.isFinite(numericQuantity);
  const safeQuantity = hasValidQuantity ? numericQuantity : 0;
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
  const requiresRecipient = type !== "adjust";
  const effectiveRecipientId = canManageStock ? recipientUserId : defaultRecipientUserId ?? null;
  const exceedsStock = type === "distribute" && safeQuantity > currentStock;
  const noChange = type === "adjust" && stockDelta === 0;
  const memberOperationAllowed = canManageStock
    || (type === "intake" && Boolean(selectedItem?.allow_member_deposit))
    || (type === "distribute" && Boolean(selectedItem?.allow_member_withdraw));
  const canSubmit = Boolean(selectedItem)
    && (!requiresRecipient || Boolean(effectiveRecipientId))
    && hasValidQuantity
    && safeQuantity >= (type === "adjust" ? 0 : 1)
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

  useEffect(() => {
    if (!opened) return;
    const nextType = canManageStock ? initialMode : initialMode === "adjust" ? "intake" : initialMode;
    const nextItem = initialItem ?? items[0] ?? null;
    setItemId(nextItem?.id ?? null);
    setRecipientUserId(
      users.some(({ user }) => user.id === defaultRecipientUserId)
        ? defaultRecipientUserId ?? null
        : users[0]?.user.id ?? defaultRecipientUserId ?? null,
    );
    setType(nextType);
    setQuantity(nextType === "adjust" ? nextItem?.quantity ?? 0 : 1);
    setNote("");
  }, [canManageStock, defaultRecipientUserId, initialItem, initialMode, items, opened, users]);

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
      size={canManageStock ? 440 : 340}
      centered={!canManageStock}
      classNames={{
        content: `storage-modal-content ${canManageStock ? "storage-admin-transaction-shell" : "storage-transaction-shell"}`,
        header: "storage-modal-header",
        body: "storage-modal-body",
      }}
    >
      <Stack
        gap="md"
        className={`storage-transaction-modal ${canManageStock ? "storage-transaction-modal--admin" : "storage-transaction-modal--simple"} ${type === "adjust" ? "storage-transaction-modal--adjust" : ""}`}
      >
        {canManageStock ? (
          <div className="storage-admin-transaction-type">
            <Text size="sm" fw={700}>{t("field.type")}</Text>
            <SegmentedControl
              fullWidth
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

        <div className={`storage-transaction-modal__summary ${toneClass} ${type === "adjust" ? "storage-transaction-modal__summary--adjust" : ""}`}>
          <div className="storage-transaction-modal__item-line">
            <Text fw={900} lineClamp={1}>{selectedItem?.name ?? t("field.item")}</Text>
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

        <div className={`storage-admin-transaction-grid ${type === "adjust" ? "storage-admin-transaction-grid--adjust" : ""}`}>
          {canManageStock ? (
            <Select
              label={t("field.item")}
              data={itemOptions}
              value={itemId}
              onChange={(value) => {
                setItemId(value);
                if (type === "adjust") {
                  setQuantity(items.find((item) => item.id === value)?.quantity ?? 0);
                }
              }}
              searchable
              nothingFoundMessage={t("empty.noItems")}
            />
          ) : null}
          {canManageStock && requiresRecipient ? (
            <Select
              label={t("field.member")}
              data={userOptions}
              value={recipientUserId}
              onChange={setRecipientUserId}
              searchable
              nothingFoundMessage={t("empty.noUsers")}
            />
          ) : null}
          <NumberInput
            hideControls
            label={type === "adjust" ? t("field.targetStock") : t("field.quantity")}
            min={type === "adjust" ? 0 : 1}
            max={type === "distribute" ? selectedItem?.quantity : undefined}
            value={quantity}
            onChange={setQuantity}
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
          <Button variant="default" onClick={onClose}>{t("common:action.cancel")}</Button>
          <Button color={toneColor} onClick={handleSubmit} loading={isSaving} disabled={!canSubmit}>
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
