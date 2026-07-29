import type { StorageCategory, StorageItem } from "@guild/shared";
import { ActionIcon, Badge, Button, Group, Image, Paper, Text } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PhotoOffIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type StorageItemCardProps = {
  item: StorageItem;
  category?: StorageCategory;
  imageUrl?: string;
  canEditItems: boolean;
  batch?: {
    type: "intake" | "distribute";
    quantity: number;
    canManageStock: boolean;
    limitReached: boolean;
    onChange: (quantity: number) => void;
  };
  onOpen: (item: StorageItem) => void;
  onDeposit: (item: StorageItem) => void;
  onWithdraw: (item: StorageItem) => void;
  onEdit: (item: StorageItem) => void;
};

export function StorageItemCard({
  item,
  category,
  imageUrl,
  canEditItems,
  batch,
  onOpen,
  onDeposit,
  onWithdraw,
  onEdit,
}: StorageItemCardProps) {
  const { t } = useTranslation("storage");
  const [imageFailed, setImageFailed] = useState(false);
  const batchAllowed = !batch
    ? false
    : batch.canManageStock
      || (batch.type === "intake" ? item.allow_member_deposit : item.allow_member_withdraw);
  const batchMax = batch?.type === "distribute" ? item.quantity : Number.MAX_SAFE_INTEGER;
  const batchQuantity = batch?.quantity ?? 0;
  const canIncreaseBatch = Boolean(batch)
    && batchAllowed
    && batchQuantity < batchMax
    && (!batch?.limitReached || batchQuantity > 0);
  const setBatchQuantity = (quantity: number) => batch?.onChange(quantity);

  return (
    <Paper withBorder radius="md" className="storage-item-card">
      <div className="storage-item-card__inner">
      {/*
        * Image on demand: an item without a picture gets no thumbnail slot at all
        * rather than an empty placeholder box. A broken URL still shows the
        * fallback, because that is a state worth seeing.
        */}
      {imageUrl ? (
        <button type="button" className="storage-item-card__preview" onClick={() => onOpen(item)} aria-label={item.name}>
          {imageFailed ? (
            <span className="storage-item-card__placeholder storage-item-card__placeholder--broken"><PhotoOffIcon size={18} /></span>
          ) : (
            <Image src={imageUrl} alt={item.name} fit="cover" className="storage-item-card__image" onError={() => setImageFailed(true)} />
          )}
        </button>
      ) : null}
      <div className="storage-item-card__body">
        <div className="storage-item-card__main">
          <div className="storage-item-card__title-row">
            <Text fw={600} lineClamp={1}>{item.name}</Text>
            <span className={`storage-item-card__stock ${item.quantity > 0 ? "storage-item-card__stock--available" : ""}`}>
              {item.quantity}
            </span>
          </div>
          <Group gap={6} className="storage-item-card__badges">
            <Badge variant="light" color="gray">{category?.name ?? t("category.uncategorized")}</Badge>
            {item.allow_member_deposit ? <Badge variant="light" color="green">{t("badge.depositEnabled")}</Badge> : null}
            {item.allow_member_withdraw ? <Badge variant="light" color="teal">{t("badge.withdrawEnabled")}</Badge> : null}
            {!item.allow_member_deposit && !item.allow_member_withdraw ? <Badge variant="light" color="gray">{t("badge.closed")}</Badge> : null}
          </Group>
        </div>
        <Group gap={6} className="storage-item-card__actions">
          {batch ? (
            <div className="storage-item-card__batch">
              {batchAllowed ? (
                <Group gap={4} wrap="nowrap">
                  <ActionIcon
                    size={28}
                    variant="default"
                    aria-label={t("action.decreaseBatchItem", { item: item.name })}
                    onClick={() => setBatchQuantity(Math.max(0, batchQuantity - 1))}
                    disabled={batchQuantity <= 0}
                  >
                    <span aria-hidden="true">−</span>
                  </ActionIcon>
                  <Text
                    component="span"
                    size="sm"
                    fw={800}
                    className="storage-item-card__batch-quantity"
                    aria-label={t("batch.quantityFor", { item: item.name })}
                  >
                    {batchQuantity}
                  </Text>
                  <ActionIcon
                    size={28}
                    variant="default"
                    aria-label={t("action.increaseBatchItem", { item: item.name })}
                    onClick={() => setBatchQuantity(Math.min(batchMax, batchQuantity + 1))}
                    disabled={!canIncreaseBatch}
                  >
                    <span aria-hidden="true">+</span>
                  </ActionIcon>
                </Group>
              ) : (
                <Text size="xs" c="dimmed">{t("batch.unavailable")}</Text>
              )}
            </div>
          ) : null}
          {item.allow_member_deposit ? (
            <Button size="compact-xs" variant="default" leftSection={<ArrowDownIcon size={13} />} onClick={() => onDeposit(item)}>
              {t("action.deposit")}
            </Button>
          ) : null}
          {item.allow_member_withdraw ? (
            <Button size="compact-xs" variant="default" leftSection={<ArrowUpIcon size={13} />} onClick={() => onWithdraw(item)} disabled={item.quantity <= 0}>
              {t("action.withdraw")}
            </Button>
          ) : null}
          {canEditItems ? (
            <ActionIcon size={30} variant="subtle" onClick={() => onEdit(item)} aria-label={t("action.edit")}>
              <PencilIcon size={15} />
            </ActionIcon>
          ) : null}
        </Group>
      </div>
      </div>
    </Paper>
  );
}
