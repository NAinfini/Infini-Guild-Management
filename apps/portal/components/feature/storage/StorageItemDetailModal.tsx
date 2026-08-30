import type { StorageItem } from "@guild/shared";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PhotoOffIcon,
  XIcon,
} from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@portal/components/ui/drawer";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@portal/components/ui/sheet";
import { useMediaQuery } from "@portal/hooks/useMediaQuery";
import { resolveMediaUrl } from "@portal/utils/media";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StorageLedgerPanel } from "./StorageLedgerPanel";

type StorageItemDetailModalProps = {
  opened: boolean;
  item: StorageItem | null;
  canEditItem: boolean;
  canManageStock: boolean;
  onClose: () => void;
  onDeposit: (item: StorageItem) => void;
  onWithdraw: (item: StorageItem) => void;
  onEdit: (item: StorageItem) => void;
};

export function StorageItemDetailModal({
  opened,
  item,
  canEditItem,
  canManageStock,
  onClose,
  onDeposit,
  onWithdraw,
  onEdit,
}: StorageItemDetailModalProps) {
  const { t } = useTranslation("storage");
  const { t: tCommon } = useTranslation("common");
  const isMobile = useMediaQuery("(max-width: 40em)");
  const [imageIndex, setImageIndex] = useState(0);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const activeImage = useMemo(
    () => item?.images[imageIndex] ?? item?.images[0] ?? null,
    [imageIndex, item],
  );
  const activeImageId = activeImage?.media_id ?? null;
  const imageIsBroken = activeImageId ? brokenImages.has(activeImageId) : false;
  const canShowPreviousImage = imageIndex > 0;
  const canShowNextImage = imageIndex < (item?.images.length ?? 0) - 1;
  useEffect(() => {
    setImageIndex(0);
    setBrokenImages(new Set());
  }, [item?.id]);

  useEffect(() => {
    setImageIndex((current) => Math.min(current, Math.max(0, (item?.images.length ?? 0) - 1)));
  }, [item?.images.length]);

  const detailBody = item ? (
    <div className="storage-detail">
      <div className="storage-detail-media">
        {activeImage && !imageIsBroken ? (
          <img
            src={resolveMediaUrl(activeImage.media_id)}
            alt={item.name}
            className="storage-detail-media__image"
            onError={() => setBrokenImages((current) => new Set(current).add(activeImage.media_id))}
          />
        ) : imageIsBroken ? (
          <div className="storage-detail-media__empty storage-detail-media__empty--broken">
            <PhotoOffIcon size={48} />
          </div>
        ) : (
          <div className="storage-detail-media__empty"><PhotoOffIcon size={44} /></div>
        )}
        {item.images.length > 1 ? (
          <div className="storage-detail-media__controls">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label={t("detail.previousImage")}
              disabled={!canShowPreviousImage}
              onClick={() => setImageIndex((value) => Math.max(0, value - 1))}
            >
              <ChevronLeftIcon size={16} />
            </Button>
            <span>{imageIndex + 1} / {item.images.length}</span>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label={t("detail.nextImage")}
              disabled={!canShowNextImage}
              onClick={() => setImageIndex((value) => Math.min(item.images.length - 1, value + 1))}
            >
              <ChevronRightIcon size={16} />
            </Button>
          </div>
        ) : null}
      </div>

      <section className="storage-detail__summary">
        <div className="storage-detail__summary-header">
          <div>
            <span className="storage-meta-label">{t("field.stock")}</span>
            <strong className="storage-detail__stock">
              {item.quantity}
              <span className="storage-detail__stock-unit">{item.unit ?? t("field.unitUnset")}</span>
            </strong>
          </div>
          <div className="storage-detail__badges">
            <Badge variant="outline">{t(`rarity.${item.rarity}`)}</Badge>
            {item.allow_member_deposit ? <Badge variant="secondary">{t("badge.depositEnabled")}</Badge> : null}
            {item.allow_member_withdraw ? <Badge variant="secondary">{t("badge.withdrawEnabled")}</Badge> : null}
            {!item.allow_member_deposit && !item.allow_member_withdraw ? (
              <Badge variant="outline">{t("badge.closed")}</Badge>
            ) : null}
          </div>
        </div>
        <p className={item.description ? undefined : "storage-detail__description--muted"}>
          {item.description || t("empty.noDescription")}
        </p>
      </section>

      <div className="storage-detail__actions">
        {canManageStock || item.allow_member_deposit ? (
          <Button variant="outline" onClick={() => onDeposit(item)}>
            <span className="storage-direction-glyph" aria-hidden="true">↓</span>
            {t("action.deposit")}
          </Button>
        ) : null}
        {canManageStock || item.allow_member_withdraw ? (
          <Button onClick={() => onWithdraw(item)} disabled={item.quantity <= 0}>
            <span className="storage-direction-glyph" aria-hidden="true">↑</span>
            {t("action.withdraw")}
          </Button>
        ) : null}
        {canEditItem ? (
          <Button variant="outline" onClick={() => onEdit(item)}>
            <PencilIcon size={16} />
            {t("action.edit")}
          </Button>
        ) : null}
      </div>

      <StorageLedgerPanel
        headingId="storage-detail-ledger-title"
        itemId={item.id}
        enabled={opened}
      />
    </div>
  ) : null;

  if (isMobile) {
    return (
      <Drawer open={opened} onOpenChange={(nextOpen) => !nextOpen && onClose()} swipeDirection="down" showSwipeHandle>
        <DrawerContent className="storage-detail-drawer">
          <DrawerHeader className="storage-modal-header">
            <div className="storage-overlay-heading">
              <DrawerTitle>{item?.name ?? ""}</DrawerTitle>
              <DrawerClose aria-label={tCommon("action.close")} render={<Button size="icon-sm" variant="ghost" />}>
                <XIcon size={16} />
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="storage-modal-body">{detailBody}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={opened} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent side="right" className="storage-detail-drawer" showCloseButton={false}>
        <SheetHeader className="storage-modal-header">
          <div className="storage-overlay-heading">
            <SheetTitle>{item?.name ?? ""}</SheetTitle>
            <SheetClose aria-label={tCommon("action.close")} render={<Button size="icon-sm" variant="ghost" />}>
              <XIcon size={16} />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="storage-modal-body">{detailBody}</div>
      </SheetContent>
    </Sheet>
  );
}
