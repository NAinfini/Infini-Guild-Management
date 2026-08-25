import type { StorageItem, StorageTransaction } from "@guild/shared";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PhotoOffIcon,
  XIcon,
} from "@portal/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
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
import { useStorageTransactions } from "@portal/hooks/useStorage";
import { formatLocaleDateTime } from "@portal/utils/datetime";
import { resolveMediaUrl } from "@portal/utils/media";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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

function txClassName(type: StorageTransaction["type"]): string {
  if (type === "intake") return "storage-ledger-row--intake";
  if (type === "distribute") return "storage-ledger-row--distribute";
  return "storage-ledger-row--adjust";
}

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
  const [ledgerPage, setLedgerPage] = useState(1);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const transactionsQuery = useStorageTransactions({
    itemId: item?.id,
    page: ledgerPage,
    limit: 20,
    enabled: opened && Boolean(item?.id),
  });
  const transactions = transactionsQuery.data?.data ?? [];
  const totalPages = transactionsQuery.data?.total_pages ?? 1;
  const activeImage = useMemo(
    () => item?.images[imageIndex] ?? item?.images[0] ?? null,
    [imageIndex, item],
  );
  const activeImageId = activeImage?.media_id ?? null;
  const imageIsBroken = activeImageId ? brokenImages.has(activeImageId) : false;
  const canShowPreviousImage = imageIndex > 0;
  const canShowNextImage = imageIndex < (item?.images.length ?? 0) - 1;
  const txLabels = {
    intake: t("tx.intake"),
    distribute: t("tx.distribute"),
    adjust: t("tx.adjust"),
  };

  useEffect(() => {
    setImageIndex(0);
    setLedgerPage(1);
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
            <strong className="storage-detail__stock">{item.quantity}</strong>
          </div>
          <div className="storage-detail__badges">
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

      <section className="storage-detail__ledger" aria-labelledby="storage-ledger-title">
        <div className="storage-detail__ledger-heading">
          <div>
            <strong id="storage-ledger-title">{t("ledger.title")}</strong>
            <span>{t("ledger.subtitle")}</span>
          </div>
          {transactionsQuery.isFetching ? <span className="storage-ledger__loading" aria-live="polite" /> : null}
        </div>

        {transactionsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("ledger.error")}</AlertTitle>
            <AlertDescription>
              <Button size="sm" variant="outline" onClick={() => void transactionsQuery.refetch()}>
                {tCommon("action.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : transactions.length > 0 ? (
          <div className="storage-ledger">
            {transactions.map((tx) => (
              <div key={tx.id} className={`storage-ledger-row ${txClassName(tx.type)}`}>
                <div className="storage-ledger-row__main">
                  <div className="storage-ledger-row__type">
                    <strong>{txLabels[tx.type]}</strong>
                    <strong className="storage-ledger-row__delta">
                      {tx.quantity_delta > 0 ? "+" : ""}{tx.quantity_delta}
                    </strong>
                  </div>
                  <span className="storage-ledger-row__actor">
                    {tx.recipient_display_name ?? tx.actor_display_name ?? tx.actor_id}
                  </span>
                  {tx.note ? <p>{tx.note}</p> : null}
                </div>
                <span className="storage-ledger-row__date">
                  {formatLocaleDateTime(tx.created_at, undefined, "numeric")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="storage-ledger__empty">{t("ledger.empty")}</p>
        )}

        {totalPages > 1 ? (
          <nav className="storage-ledger-pagination" aria-label={t("ledger.title")}>
            <Button
              size="sm"
              variant="outline"
              aria-label={tCommon("pagination.prev")}
              disabled={ledgerPage <= 1}
              onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
            >
              <ChevronLeftIcon size={14} />
            </Button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <Button
                key={page}
                size="sm"
                variant={page === ledgerPage ? "default" : "outline"}
                aria-label={String(page)}
                aria-current={page === ledgerPage ? "page" : undefined}
                onClick={() => setLedgerPage(page)}
              >
                {page}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              aria-label={tCommon("pagination.next")}
              disabled={ledgerPage >= totalPages}
              onClick={() => setLedgerPage((page) => Math.min(totalPages, page + 1))}
            >
              <ChevronRightIcon size={14} />
            </Button>
          </nav>
        ) : null}
      </section>
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
