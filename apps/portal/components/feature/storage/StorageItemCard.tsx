import type { StorageCategory, StorageItem } from "@guild/shared";
import { PencilIcon, PhotoOffIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
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
      <button
        type="button"
        className="storage-item-card__main"
        aria-label={item.name}
        onClick={() => onOpen(item)}
      >
        <span className="storage-item-card__preview" aria-hidden="true">
          {imageUrl && !imageFailed ? (
            <img
              src={imageUrl}
              alt=""
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
          <span className="storage-item-card__name" title={item.name}>{item.name}</span>
          <span className="storage-item-card__badges">
            <span className="storage-item-card__category">
              {category?.name ?? t("category.uncategorized")}
            </span>
            {item.allow_member_deposit ? (
              <Badge variant="secondary">{t("badge.depositEnabled")}</Badge>
            ) : null}
            {item.allow_member_withdraw ? (
              <Badge variant="secondary">{t("badge.withdrawEnabled")}</Badge>
            ) : null}
            {!item.allow_member_deposit && !item.allow_member_withdraw ? (
              <Badge variant="outline">{t("badge.closed")}</Badge>
            ) : null}
          </span>
        </span>

        <span
          className={`storage-item-card__stock ${item.quantity > 0 ? "storage-item-card__stock--available" : ""}`}
        >
          <span className="storage-item-card__stock-label">{t("field.stock")}</span>
          <span className="storage-item-card__stock-value">{item.quantity}</span>
        </span>
      </button>

      <div className="storage-item-card__actions">
        {batch ? (
          batchAllowed ? (
            <div className="storage-item-card__batch">
              <Button
                size="icon-lg"
                variant="outline"
                aria-label={t("action.decreaseBatchItem", { item: item.name })}
                onClick={() => setBatchQuantity(Math.max(0, batchQuantity - 1))}
                disabled={batchQuantity <= 0}
              >
                <span aria-hidden="true">−</span>
              </Button>
              <span
                className="storage-item-card__batch-quantity"
                aria-label={t("batch.quantityFor", { item: item.name })}
              >
                {batchQuantity}
              </span>
              <Button
                size="icon-lg"
                variant="outline"
                aria-label={t("action.increaseBatchItem", { item: item.name })}
                onClick={() => setBatchQuantity(Math.min(batchMax, batchQuantity + 1))}
                disabled={!canIncreaseBatch}
              >
                <span aria-hidden="true">+</span>
              </Button>
            </div>
          ) : (
            <span className="storage-item-card__unavailable">{t("batch.unavailable")}</span>
          )
        ) : (
          <>
            {canDeposit ? (
              <Button size="sm" variant="outline" onClick={() => onDeposit(item)}>
                <span className="storage-direction-glyph" aria-hidden="true">↓</span>
                {t("action.deposit")}
              </Button>
            ) : null}
            {canWithdraw ? (
              <Button size="sm" onClick={() => onWithdraw(item)} disabled={item.quantity <= 0}>
                <span className="storage-direction-glyph" aria-hidden="true">↑</span>
                {t("action.withdraw")}
              </Button>
            ) : null}
            {canEditItems ? (
              <Button
                size="icon-lg"
                variant="ghost"
                onClick={() => onEdit(item)}
                aria-label={t("action.edit")}
              >
                <PencilIcon size={16} />
              </Button>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
