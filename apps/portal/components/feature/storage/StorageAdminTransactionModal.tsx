import type { CreateStorageTransactionPayload, StorageItem, User } from "@guild/shared";
import { Badge, Button, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text, Textarea } from "@mantine/core";
import { ArrowRightIcon } from "@portal/components/icons";
import { useEffect, useMemo, useState } from "react";

type AdminTransactionMode = CreateStorageTransactionPayload["type"];
type UserOption = { user: User };

type StorageAdminTransactionModalProps = {
  opened: boolean;
  items: StorageItem[];
  users: UserOption[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (itemId: string, payload: CreateStorageTransactionPayload) => void;
  labels: {
    title: string;
    item: string;
    member: string;
    type: string;
    currentStock: string;
    stockAfter: string;
    stockChange: string;
    quantity: string;
    note: string;
    intake: string;
    distribute: string;
    adjust: string;
    targetStock: string;
    cancel: string;
    submit: string;
    summary: string;
    adjustSummary: string;
    noItems: string;
    noUsers: string;
  };
};

export function StorageAdminTransactionModal({
  opened,
  items,
  users,
  isSaving,
  onClose,
  onSubmit,
  labels,
}: StorageAdminTransactionModalProps) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [type, setType] = useState<AdminTransactionMode>("intake");
  const [quantity, setQuantity] = useState<number | string>(1);
  const [note, setNote] = useState("");

  const selectedItem = items.find((item) => item.id === itemId) ?? null;
  const selectedUser = users.find(({ user }) => user.id === userId)?.user ?? null;
  const itemOptions = useMemo(() => items.map((item) => ({ value: item.id, label: `${item.name} (${item.quantity})` })), [items]);
  const userOptions = useMemo(() => users.map(({ user }) => ({ value: user.id, label: user.username })), [users]);
  const numericQuantity = typeof quantity === "number" ? quantity : Number.parseInt(String(quantity), 10);
  const hasValidQuantity = Number.isFinite(numericQuantity);
  const safeQuantity = hasValidQuantity ? numericQuantity : 0;
  const currentStock = selectedItem?.quantity ?? 0;
  const projectedStock = type === "adjust" ? safeQuantity : Math.max(0, currentStock + (type === "intake" ? safeQuantity : -safeQuantity));
  const stockDelta = type === "adjust" ? projectedStock - currentStock : type === "intake" ? safeQuantity : -safeQuantity;
  const isPositiveChange = stockDelta >= 0;
  const requiresMember = type !== "adjust";
  const exceedsStock = !isPositiveChange && safeQuantity > currentStock;
  const noChange = type === "adjust" && stockDelta === 0;
  const canSubmit = Boolean(itemId) && (!requiresMember || Boolean(userId)) && hasValidQuantity && safeQuantity >= (type === "adjust" ? 0 : 1) && !exceedsStock && !noChange;
  const summaryAction = type === "intake" ? labels.intake : labels.distribute;
  const toneClass = isPositiveChange ? "storage-transaction-modal__summary--deposit" : "storage-transaction-modal__summary--withdraw";
  const toneColor = type === "adjust" ? "orange" : isPositiveChange ? "green" : "blue";

  useEffect(() => {
    if (!opened) return;
    setItemId(items[0]?.id ?? null);
    setUserId(users[0]?.user.id ?? null);
    setType("intake");
    setQuantity(1);
    setNote("");
  }, [items, opened, users]);

  const handleSubmit = () => {
    if (!itemId || !canSubmit) return;
    const parsedQuantity = typeof quantity === "number" ? quantity : Number.parseInt(String(quantity), 10);
    const trimmedNote = note.trim() || null;
    if (type === "adjust") {
      onSubmit(itemId, { type, target_quantity: parsedQuantity, note: trimmedNote });
      return;
    }
    onSubmit(itemId, { type, quantity: parsedQuantity, recipient_user_id: userId, note: trimmedNote });
  };

  return (
    <Modal opened={opened} onClose={onClose} title={labels.title} size={420} classNames={{ content: "storage-modal-content storage-admin-transaction-shell", header: "storage-modal-header", body: "storage-modal-body" }}>
      <Stack gap="md" className={`storage-transaction-modal storage-transaction-modal--admin ${type === "adjust" ? "storage-transaction-modal--adjust" : ""}`}>
        <div className="storage-admin-transaction-type">
          <Text size="sm" fw={700}>{labels.type}</Text>
          <SegmentedControl
            fullWidth
            data={[
              { value: "intake", label: labels.intake },
              { value: "distribute", label: labels.distribute },
              { value: "adjust", label: labels.adjust },
            ]}
            value={type}
            onChange={(value) => {
              const nextType = (value as AdminTransactionMode) ?? "intake";
              setType(nextType);
              setQuantity(nextType === "adjust" ? currentStock : 1);
            }}
          />
        </div>
        <div className={`storage-transaction-modal__summary ${toneClass} ${type === "adjust" ? "storage-transaction-modal__summary--adjust" : ""}`}>
          <div className="storage-transaction-modal__item-line">
            <Text fw={900} lineClamp={1}>{selectedItem?.name ?? labels.item}</Text>
            <Badge variant="light" color={toneColor}>{stockDelta > 0 ? "+" : ""}{stockDelta}</Badge>
          </div>
          <div className="storage-transaction-flow">
            <div>
              <Text size="xs" c="dimmed">{labels.currentStock}</Text>
              <Text fw={900} className="storage-transaction-flow__value">{currentStock}</Text>
            </div>
            <span className={`storage-transaction-flow__arrow ${isPositiveChange ? "storage-transaction-flow__arrow--deposit" : "storage-transaction-flow__arrow--withdraw"}`}>
              <ArrowRightIcon size={18} />
            </span>
            <div>
              <Text size="xs" c="dimmed">{labels.stockAfter}</Text>
              <Text fw={900} className="storage-transaction-flow__value">{projectedStock}</Text>
            </div>
          </div>
        </div>
        <div className={`storage-admin-transaction-grid ${type === "adjust" ? "storage-admin-transaction-grid--adjust" : ""}`}>
          <Select
            label={labels.item}
            data={itemOptions}
            value={itemId}
            onChange={(value) => {
              setItemId(value);
              if (type === "adjust") {
                setQuantity(items.find((item) => item.id === value)?.quantity ?? 0);
              }
            }}
            searchable
            nothingFoundMessage={labels.noItems}
          />
          {requiresMember ? <Select label={labels.member} data={userOptions} value={userId} onChange={setUserId} searchable nothingFoundMessage={labels.noUsers} /> : null}
          <NumberInput hideControls label={type === "adjust" ? labels.targetStock : labels.quantity} min={type === "adjust" ? 0 : 1} max={type === "distribute" ? selectedItem?.quantity : undefined} value={quantity} onChange={setQuantity} />
        </div>
        {selectedItem && type === "adjust" ? (
          <Text size="sm" className="storage-admin-transaction-summary">
            {labels.adjustSummary
              .replace("{{quantity}}", String(projectedStock))
              .replace("{{item}}", selectedItem.name)}
          </Text>
        ) : null}
        {selectedItem && selectedUser && type !== "adjust" ? (
          <Text size="sm" className="storage-admin-transaction-summary">
            {labels.summary
              .replace("{{member}}", selectedUser.username)
              .replace("{{action}}", summaryAction)
              .replace("{{quantity}}", String(quantity || 0))
              .replace("{{item}}", selectedItem.name)}
          </Text>
        ) : null}
        <Textarea label={labels.note} minRows={3} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
        <Group justify="flex-end" className="storage-transaction-modal__actions">
          <Button variant="default" onClick={onClose}>{labels.cancel}</Button>
          <Button color={toneColor} onClick={handleSubmit} loading={isSaving} disabled={!canSubmit}>
            {labels.submit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
