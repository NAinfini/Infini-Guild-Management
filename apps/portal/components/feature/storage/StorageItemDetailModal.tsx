import type { StorageItem, StorageTransaction } from "@guild/shared";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Image,
  Loader,
  Pagination,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PhotoOffIcon,
} from "@portal/components/icons";
import { useStorageTransactions } from "@portal/hooks/useStorage";
import { resolveStorageMediaUrl } from "@portal/utils/media";
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

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

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
  const activeImageKey = activeImage?.r2_key ?? null;
  const imageIsBroken = activeImageKey ? brokenImages.has(activeImageKey) : false;
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
    setImageIndex((current) =>
      Math.min(current, Math.max(0, (item?.images.length ?? 0) - 1)),
    );
  }, [item?.images.length]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={item?.name ?? ""}
      position="right"
      size={isMobile ? "100%" : 520}
      classNames={{
        content: "storage-detail-drawer",
        header: "storage-modal-header",
        body: "storage-modal-body",
      }}
    >
      {item ? (
        <Stack gap="lg" className="storage-detail" style={{ minWidth: 0, maxWidth: "100%" }}>
          <aside className="storage-detail-media" style={{ minWidth: 0 }}>
            {activeImage && !imageIsBroken ? (
              <Image
                src={resolveStorageMediaUrl(activeImage.r2_key)}
                alt={item.name}
                fit="contain"
                className="storage-detail-media__image"
                onError={() =>
                  setBrokenImages((current) => new Set(current).add(activeImage.r2_key))
                }
              />
            ) : imageIsBroken ? (
              <div className="storage-detail-media__empty storage-detail-media__empty--broken">
                <PhotoOffIcon size={48} />
              </div>
            ) : (
              <div className="storage-detail-media__empty">
                <PhotoOffIcon size={44} />
              </div>
            )}
            {item.images.length > 1 ? (
              <Group justify="center" mt={8} wrap="nowrap">
                <ActionIcon
                  variant="default"
                  size={44}
                  aria-label={t("detail.previousImage")}
                  disabled={!canShowPreviousImage}
                  onClick={() => setImageIndex((value) => Math.max(0, value - 1))}
                >
                  <ChevronLeftIcon size={16} />
                </ActionIcon>
                <Text size="xs">{imageIndex + 1} / {item.images.length}</Text>
                <ActionIcon
                  variant="default"
                  size={44}
                  aria-label={t("detail.nextImage")}
                  disabled={!canShowNextImage}
                  onClick={() =>
                    setImageIndex((value) => Math.min(item.images.length - 1, value + 1))
                  }
                >
                  <ChevronRightIcon size={16} />
                </ActionIcon>
              </Group>
            ) : null}
          </aside>

          <section className="storage-detail__summary">
            <Group justify="space-between" align="flex-end" gap="md" wrap="nowrap">
              <div>
                <Text size="xs" c="dimmed">{t("field.stock")}</Text>
                <Text className="storage-detail__stock">{item.quantity}</Text>
              </div>
              <Group gap={6}>
                {item.allow_member_deposit ? (
                  <Badge variant="light">{t("badge.depositEnabled")}</Badge>
                ) : null}
                {item.allow_member_withdraw ? (
                  <Badge variant="light">{t("badge.withdrawEnabled")}</Badge>
                ) : null}
                {!item.allow_member_deposit && !item.allow_member_withdraw ? (
                  <Badge variant="light" color="gray">{t("badge.closed")}</Badge>
                ) : null}
              </Group>
            </Group>
            <Text size="sm" mt="md" c={item.description ? undefined : "dimmed"}>
              {item.description || t("empty.noDescription")}
            </Text>
          </section>

          <Group grow className="storage-detail__actions">
            {canManageStock || item.allow_member_deposit ? (
              <Button
                variant="default"
                leftSection={<span className="storage-direction-glyph" aria-hidden>↓</span>}
                onClick={() => onDeposit(item)}
              >
                {t("action.deposit")}
              </Button>
            ) : null}
            {canManageStock || item.allow_member_withdraw ? (
              <Button
                leftSection={<span className="storage-direction-glyph" aria-hidden>↑</span>}
                onClick={() => onWithdraw(item)}
                disabled={item.quantity <= 0}
              >
                {t("action.withdraw")}
              </Button>
            ) : null}
            {canEditItem ? (
              <Button
                variant="default"
                leftSection={<PencilIcon size={16} />}
                onClick={() => onEdit(item)}
              >
                {t("action.edit")}
              </Button>
            ) : null}
          </Group>

          <section className="storage-detail__ledger">
            <Group justify="space-between" gap={8} mb="sm">
              <div>
                <Text fw={800}>{t("ledger.title")}</Text>
                <Text size="xs" c="dimmed">{t("ledger.subtitle")}</Text>
              </div>
              {transactionsQuery.isFetching ? <Loader size="xs" /> : null}
            </Group>

            {transactionsQuery.isError ? (
              <Alert color="red" title={t("ledger.error")}>
                <Button
                  mt="sm"
                  size="compact-sm"
                  variant="default"
                  onClick={() => void transactionsQuery.refetch()}
                >
                  {tCommon("action.retry")}
                </Button>
              </Alert>
            ) : transactions.length > 0 ? (
              <div className="storage-ledger">
                {transactions.map((tx) => (
                  <div key={tx.id} className={`storage-ledger-row ${txClassName(tx.type)}`}>
                    <Group justify="space-between" gap="sm" align="flex-start" wrap="nowrap">
                      <div className="storage-ledger-row__main">
                        <Group gap={8}>
                          <Text size="sm" fw={700}>{txLabels[tx.type]}</Text>
                          <Text fw={900} className="storage-ledger-row__delta">
                            {tx.quantity_delta > 0 ? "+" : ""}{tx.quantity_delta}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>
                          {tx.recipient_username ?? tx.actor_username ?? tx.actor_id}
                        </Text>
                        {tx.note ? <Text size="sm" mt={4}>{tx.note}</Text> : null}
                      </div>
                      <Text size="xs" c="dimmed" className="storage-ledger-row__date">
                        {formatDateTime(tx.created_at)}
                      </Text>
                    </Group>
                  </div>
                ))}
              </div>
            ) : (
              <Text size="sm" c="dimmed">{t("ledger.empty")}</Text>
            )}

            {totalPages > 1 ? (
              <Pagination
                className="storage-ledger-pagination"
                value={ledgerPage}
                total={totalPages}
                onChange={setLedgerPage}
                withEdges
                size="sm"
                getControlProps={(control) => ({
                  "aria-label": tCommon(
                    control === "previous" ? "pagination.prev" : `pagination.${control}`,
                  ),
                })}
              />
            ) : null}
          </section>
        </Stack>
      ) : null}
    </Drawer>
  );
}
