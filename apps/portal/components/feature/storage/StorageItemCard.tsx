import type { StorageCategory, StorageItem } from "@guild/shared";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Image,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  PencilIcon,
  PhotoOffIcon,
} from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type StorageItemCardProps = {
  item: StorageItem;
  category?: StorageCategory;
  imageUrl?: string;
  canEditItems: boolean;
  canManageStock: boolean;
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
  canManageStock,
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
  const canDeposit = canManageStock || item.allow_member_deposit;
  const canWithdraw = canManageStock || item.allow_member_withdraw;

  return (
    <article className="storage-item-card">
      <UnstyledButton
        type="button"
        className="storage-item-card__main"
        aria-label={item.name}
        onClick={() => onOpen(item)}
      >
        <span className="storage-item-card__preview" aria-hidden>
          {imageUrl && !imageFailed ? (
            <Image
              src={imageUrl}
              alt=""
              fit="cover"
              className="storage-item-card__image"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span
              className={`storage-item-card__placeholder ${imageFailed ? "storage-item-card__placeholder--broken" : ""}`}
            >
              <PhotoOffIcon size={18} />
            </span>
          )}
        </span>

        <span className="storage-item-card__identity">
          <Text component="span" fw={700} lineClamp={1}>{item.name}</Text>
          <Group component="span" gap={6} wrap="wrap" className="storage-item-card__badges">
            <Text component="span" size="xs" c="dimmed">
              {category?.name ?? t("category.uncategorized")}
            </Text>
            {item.allow_member_deposit ? (
              <Badge component="span" variant="light" size="xs">{t("badge.depositEnabled")}</Badge>
            ) : null}
            {item.allow_member_withdraw ? (
              <Badge component="span" variant="light" size="xs">{t("badge.withdrawEnabled")}</Badge>
            ) : null}
            {!item.allow_member_deposit && !item.allow_member_withdraw ? (
              <Badge component="span" variant="light" color="gray" size="xs">{t("badge.closed")}</Badge>
            ) : null}
          </Group>
        </span>

        <span
          className={`storage-item-card__stock ${item.quantity > 0 ? "storage-item-card__stock--available" : ""}`}
        >
          <Text component="span" size="xs" c="dimmed">{t("field.stock")}</Text>
          <Text component="span" className="storage-item-card__stock-value">{item.quantity}</Text>
        </span>
      </UnstyledButton>

      <Group gap={6} wrap="nowrap" className="storage-item-card__actions">
        {batch ? (
          batchAllowed ? (
            <Group gap={4} wrap="nowrap" className="storage-item-card__batch">
              <ActionIcon
                size={40}
                variant="default"
                aria-label={t("action.decreaseBatchItem", { item: item.name })}
                onClick={() => setBatchQuantity(Math.max(0, batchQuantity - 1))}
                disabled={batchQuantity <= 0}
              >
                <span aria-hidden="true">−</span>
              </ActionIcon>
              <Text
                component="span"
                fw={800}
                className="storage-item-card__batch-quantity"
                aria-label={t("batch.quantityFor", { item: item.name })}
              >
                {batchQuantity}
              </Text>
              <ActionIcon
                size={40}
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
          )
        ) : (
          <>
            {canDeposit ? (
              <Button
                size="compact-sm"
                variant="default"
                leftSection={<span className="storage-direction-glyph" aria-hidden>↓</span>}
                onClick={() => onDeposit(item)}
              >
                {t("action.deposit")}
              </Button>
            ) : null}
            {canWithdraw ? (
              <Button
                size="compact-sm"
                leftSection={<span className="storage-direction-glyph" aria-hidden>↑</span>}
                onClick={() => onWithdraw(item)}
                disabled={item.quantity <= 0}
              >
                {t("action.withdraw")}
              </Button>
            ) : null}
            {canEditItems ? (
              <ActionIcon
                size={40}
                variant="subtle"
                onClick={() => onEdit(item)}
                aria-label={t("action.edit")}
              >
                <PencilIcon size={16} />
              </ActionIcon>
            ) : null}
          </>
        )}
      </Group>
    </article>
  );
}
