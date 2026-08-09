import type { StorageItem, User } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { TrashIcon, XIcon } from "@portal/components/icons";
import { useMemo, useState } from "react";
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
    >
      <Paper withBorder className="storage-batch-bar">
        <Group justify="space-between" gap="md" wrap="wrap">
          <div className="storage-batch-bar__identity">
            <Text fw={800}>{t("batch.title")}</Text>
            <Text size="sm" c="dimmed">{t("batch.selectHint")}</Text>
          </div>

          <SegmentedControl
            className="storage-batch-bar__direction"
            value={draft.type}
            onChange={(value) => onTypeChange(value as StorageBatchDirection)}
            data={[
              { value: "intake", label: t("tx.intake") },
              { value: "distribute", label: t("tx.distribute") },
            ]}
          />

          <Group gap="lg" className="storage-batch-bar__summary">
            <div>
              <Text size="xs" c="dimmed">{t("batch.selectedItems")}</Text>
              <Text fw={800} className="storage-batch-bar__value">{selectedEntries.length}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t("batch.totalUnits")}</Text>
              <Text fw={800} className="storage-batch-bar__value">{totalQuantity}</Text>
            </div>
          </Group>

          <Group gap="xs" wrap="nowrap" className="storage-batch-bar__actions">
            <Button
              variant="default"
              onClick={() => setReviewOpened(true)}
              disabled={selectedEntries.length === 0}
            >
              {t("action.reviewBatch")}
            </Button>
            <ActionIcon
              variant="subtle"
              size={44}
              aria-label={t("action.closeBatch")}
              onClick={onClose}
              disabled={isSaving}
            >
              <XIcon size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </Paper>

      <Drawer
        opened={reviewOpened}
        onClose={() => setReviewOpened(false)}
        title={t("batch.reviewTitle")}
        position="right"
        size={isMobile ? "100%" : 440}
        classNames={{
          content: "storage-batch-drawer",
          header: "storage-modal-header",
          body: "storage-modal-body",
        }}
      >
        <Stack gap="lg">
          <div className="storage-batch-review__summary">
            <Group justify="space-between" gap="md">
              <div>
                <Text size="xs" c="dimmed">{t("field.direction")}</Text>
                <Text fw={800}>{draft.type === "intake" ? t("tx.intake") : t("tx.distribute")}</Text>
              </div>
              <Group gap="lg">
                <div>
                  <Text size="xs" c="dimmed">{t("batch.selectedItems")}</Text>
                  <Text fw={800}>{selectedEntries.length}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">{t("batch.totalUnits")}</Text>
                  <Text fw={800}>{totalQuantity}</Text>
                </div>
              </Group>
            </Group>
          </div>

          {canManageStock ? (
            <Select
              label={t("field.member")}
              data={userOptions}
              value={draft.recipientUserId}
              onChange={onRecipientChange}
              searchable
              withAsterisk
              /* 没选人时直接把原因写在字段上：否则提交按钮灰着，用户看不出差在哪。 */
              error={draft.recipientUserId ? null : t("validation.recipientRequired")}
              nothingFoundMessage={t("empty.noUsers")}
              disabled={isSaving}
            />
          ) : (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">{t("field.member")}</Text>
              <Badge variant="light">{currentUsername ?? t("batch.currentMember")}</Badge>
            </Group>
          )}

          <div>
            <Group justify="space-between" gap="xs" mb="xs">
              <Text size="sm" fw={700}>{t("batch.itemsToApply")}</Text>
              <Button
                size="compact-sm"
                variant="subtle"
                color="red"
                onClick={onClear}
                disabled={selectedEntries.length === 0 || isSaving}
              >
                {t("action.clearBatch")}
              </Button>
            </Group>
            <Stack gap={6} className="storage-batch-review__items">
              {selectedEntries.map(({ itemId, item, quantity }) => (
                <Group
                  key={itemId}
                  justify="space-between"
                  wrap="nowrap"
                  className="storage-batch-review__item"
                >
                  <Text size="sm" lineClamp={1} title={item?.name ?? itemId}>
                    {item?.name ?? itemId}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Badge variant="light">×{quantity}</Badge>
                    <ActionIcon
                      size={36}
                      variant="subtle"
                      color="red"
                      aria-label={t("action.removeBatchItem", { item: item?.name ?? itemId })}
                      onClick={() => onQuantityChange(itemId, 0)}
                      disabled={isSaving}
                    >
                      <TrashIcon size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Stack>
          </div>

          {selectionInvalid ? (
            <Text size="sm" c="red" role="alert">
              {t("batch.selectionChanged")}
            </Text>
          ) : null}

          <Textarea
            label={t("field.note")}
            value={draft.note}
            onChange={(event) => onNoteChange(event.currentTarget.value)}
            minRows={3}
            autosize
            disabled={isSaving}
          />

          <Button
            fullWidth
            size="md"
            onClick={onSubmit}
            loading={isSaving}
            disabled={!canSubmit}
          >
            {t("action.submitBatch", { count: selectedEntries.length })}
          </Button>
        </Stack>
      </Drawer>
    </aside>
  );
}
