import type { CreateStorageTransactionPayload, StorageItem } from "@guild/shared";
import { Badge, Button, Group, Modal, NumberInput, Stack, Text, Textarea } from "@mantine/core";
import { ArrowRightIcon } from "@portal/components/icons";
import { useEffect, useState } from "react";

type TransactionMode = Extract<CreateStorageTransactionPayload["type"], "intake" | "distribute">;

type StorageTransactionModalProps = {
  opened: boolean;
  item: StorageItem | null;
  mode: TransactionMode;
  defaultRecipientUserId?: string;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (itemId: string, payload: CreateStorageTransactionPayload) => void;
  labels: {
    currentStock: string;
    stockAfter: string;
    stockChange: string;
    depositTitle: string;
    withdrawTitle: string;
    quantity: string;
    note: string;
    cancel: string;
    submitDeposit: string;
    submitWithdraw: string;
  };
};

export function StorageTransactionModal({
  opened,
  item,
  mode,
  defaultRecipientUserId,
  isSaving,
  onClose,
  onSubmit,
  labels,
}: StorageTransactionModalProps) {
  const [quantity, setQuantity] = useState<number | string>(1);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!opened) return;
    setQuantity(1);
    setNote("");
  }, [opened]);

  const handleSubmit = () => {
    if (!item) return;
    const parsedQuantity = typeof quantity === "number" ? quantity : Number.parseInt(String(quantity), 10);
    onSubmit(item.id, {
      type: mode,
      quantity: parsedQuantity,
      recipient_user_id: defaultRecipientUserId,
      note: note.trim() || null,
    });
  };

  const isDeposit = mode === "intake";
  const actionTitle = isDeposit ? labels.depositTitle : labels.withdrawTitle;
  const numericQuantity = typeof quantity === "number" ? quantity : Number.parseInt(String(quantity), 10);
  const safeQuantity = Number.isFinite(numericQuantity) ? numericQuantity : 0;
  const currentStock = item?.quantity ?? 0;
  const stockDelta = isDeposit ? safeQuantity : -safeQuantity;
  const projectedStock = Math.max(0, currentStock + stockDelta);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={item ? `${actionTitle}: ${item.name}` : actionTitle}
      size={340}
      centered
      classNames={{ content: "storage-modal-content storage-transaction-shell", header: "storage-modal-header", body: "storage-modal-body" }}
    >
      <Stack gap="md" className="storage-transaction-modal storage-transaction-modal--simple">
        <div className={`storage-transaction-modal__summary ${isDeposit ? "storage-transaction-modal__summary--deposit" : "storage-transaction-modal__summary--withdraw"}`}>
          <div className="storage-transaction-modal__item-line">
            <Text fw={900} lineClamp={1}>{item?.name ?? actionTitle}</Text>
            <Badge variant="light" color={isDeposit ? "green" : "blue"}>{stockDelta > 0 ? "+" : ""}{stockDelta}</Badge>
          </div>
          <div className="storage-transaction-flow">
            <div>
              <Text size="xs" c="dimmed">{labels.currentStock}</Text>
              <Text fw={900} className="storage-transaction-flow__value">{currentStock}</Text>
            </div>
            <span className={`storage-transaction-flow__arrow ${isDeposit ? "storage-transaction-flow__arrow--deposit" : "storage-transaction-flow__arrow--withdraw"}`}>
              <ArrowRightIcon size={18} />
            </span>
            <div>
              <Text size="xs" c="dimmed">{labels.stockAfter}</Text>
              <Text fw={900} className="storage-transaction-flow__value">{projectedStock}</Text>
            </div>
          </div>
        </div>
        <div className="storage-transaction-modal__form">
          <NumberInput hideControls label={labels.quantity} min={1} max={isDeposit ? undefined : item?.quantity} value={quantity} onChange={setQuantity} />
          <Textarea autosize label={labels.note} minRows={2} maxRows={4} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
        </div>
        <Group justify="flex-end" className="storage-transaction-modal__actions">
          <Button variant="default" onClick={onClose}>{labels.cancel}</Button>
          <Button color={isDeposit ? "green" : "blue"} onClick={handleSubmit} loading={isSaving} disabled={!item || (!isDeposit && safeQuantity > currentStock)}>
            {isDeposit ? labels.submitDeposit : labels.submitWithdraw}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
