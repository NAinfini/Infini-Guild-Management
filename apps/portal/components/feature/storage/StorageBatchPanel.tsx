import type { StorageItem, User } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { TrashIcon, XIcon } from "@portal/components/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type StorageBatchDirection = "intake" | "distribute";

export type StorageBatchDraft = {
  idempotencyKey: string;
  type: StorageBatchDirection;
  quantities: Record<string, number>;
  itemSnapshots: Record<string, StorageItem>;
  recipientUserId: string | null;
  note: string;
};

type UserOption = { user: User };

type StorageBatchPanelProps = {
  draft: StorageBatchDraft;
  users: UserOption[];
  currentUsername?: string;
  canManageStock: boolean;
  isSaving: boolean;
  onTypeChange: (type: StorageBatchDirection) => void;
  onRecipientChange: (userId: string | null) => void;
  onNoteChange: (note: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onClear: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function StorageBatchPanel({
  draft,
  users,
  currentUsername,
  canManageStock,
  isSaving,
  onTypeChange,
  onRecipientChange,
  onNoteChange,
  onQuantityChange,
  onClear,
  onClose,
  onSubmit,
}: StorageBatchPanelProps) {
  const { t } = useTranslation("storage");
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
  const userOptions = users.map(({ user }) => ({ value: user.id, label: user.username }));
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

  return (
    <aside
      id="storage-batch-panel"
      className="storage-batch-panel"
      aria-label={t("batch.title")}
      tabIndex={-1}
    >
      <Paper withBorder radius="md" className="storage-batch-panel__card">
        <div className="storage-batch-panel__inner">
          <Stack gap="md">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text fw={800}>{t("batch.title")}</Text>
              <Text size="sm" c="dimmed">{t("batch.subtitle")}</Text>
            </div>
            <ActionIcon
              variant="subtle"
              aria-label={t("action.closeBatch")}
              onClick={onClose}
              disabled={isSaving}
            >
              <XIcon size={16} />
            </ActionIcon>
          </Group>

          <SegmentedControl
            fullWidth
            value={draft.type}
            onChange={(value) => onTypeChange(value as StorageBatchDirection)}
            data={[
              { value: "intake", label: t("tx.intake") },
              { value: "distribute", label: t("tx.distribute") },
            ]}
          />

          {canManageStock ? (
            <Select
              label={t("field.member")}
              data={userOptions}
              value={draft.recipientUserId}
              onChange={onRecipientChange}
              searchable
              nothingFoundMessage={t("empty.noUsers")}
              disabled={isSaving}
            />
          ) : (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">{t("field.member")}</Text>
              <Badge variant="light">{currentUsername ?? t("batch.currentMember")}</Badge>
            </Group>
          )}

          <Divider />

          <Group justify="space-between" gap="xs">
            <Text size="sm" fw={700}>
              {t("batch.pendingItems", { count: selectedEntries.length })}
            </Text>
            <Text size="sm" c="dimmed">
              {t("batch.totalQuantity", { count: totalQuantity })}
            </Text>
          </Group>

          {selectedEntries.length === 0 ? (
            <Text size="sm" c="dimmed" className="storage-batch-panel__empty">
              {t("batch.empty")}
            </Text>
          ) : (
            <Stack gap={6} className="storage-batch-panel__items">
              {selectedEntries.map(({ itemId, item, quantity }) => (
                <Group key={itemId} justify="space-between" wrap="nowrap" className="storage-batch-panel__item">
                  <Text size="sm" lineClamp={1} title={item?.name ?? itemId}>
                    {item?.name ?? itemId}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Badge variant="light">×{quantity}</Badge>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label={t("action.removeBatchItem", { item: item?.name ?? itemId })}
                      onClick={() => onQuantityChange(itemId, 0)}
                      disabled={isSaving}
                    >
                      <TrashIcon size={13} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
          {selectionInvalid ? (
            <Text size="sm" c="red" role="alert">
              {t("batch.selectionChanged")}
            </Text>
          ) : null}

          <Textarea
            label={t("field.note")}
            value={draft.note}
            onChange={(event) => onNoteChange(event.currentTarget.value)}
            minRows={2}
            autosize
            disabled={isSaving}
          />

          <Group justify="space-between" align="stretch" className="storage-batch-panel__actions">
            <Button
              variant="subtle"
              color="red"
              onClick={onClear}
              disabled={selectedEntries.length === 0 || isSaving}
            >
              {t("action.clearBatch")}
            </Button>
            <Button onClick={onSubmit} loading={isSaving} disabled={!canSubmit}>
              {t("action.submitBatch", { count: selectedEntries.length })}
            </Button>
          </Group>
          </Stack>
        </div>
      </Paper>
    </aside>
  );
}
