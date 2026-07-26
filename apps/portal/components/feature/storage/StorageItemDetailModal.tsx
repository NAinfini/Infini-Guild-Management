import type { StorageItem, StorageTransaction } from "@guild/shared";
import { ActionIcon, Badge, Group, Image, Modal, Stack, Text } from "@mantine/core";
import { ChevronLeftIcon, ChevronRightIcon, PhotoOffIcon } from "@portal/components/icons";
import { useEffect, useMemo, useState } from "react";

type StorageItemDetailModalProps = {
  opened: boolean;
  item: StorageItem | null;
  transactions: StorageTransaction[];
  resolveImageUrl: (key: string) => string;
  formatDateTime: (iso: string) => string;
  onClose: () => void;
  labels: {
    stock: string;
    description: string;
    noDescription: string;
    ledger: string;
    emptyLedger: string;
    intake: string;
    distribute: string;
    adjust: string;
    recipient: string;
    note: string;
    actor: string;
    date: string;
    stockChange: string;
  };
};

function txClassName(type: StorageTransaction["type"]): string {
  if (type === "intake") return "storage-ledger-row--intake";
  if (type === "distribute") return "storage-ledger-row--distribute";
  return "storage-ledger-row--adjust";
}

export function StorageItemDetailModal({
  opened,
  item,
  transactions,
  resolveImageUrl,
  formatDateTime,
  onClose,
  labels,
}: StorageItemDetailModalProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const activeImage = useMemo(() => item?.images[imageIndex] ?? item?.images[0] ?? null, [imageIndex, item]);
  const activeImageKey = activeImage?.r2_key ?? null;
  const imageIsBroken = activeImageKey ? brokenImages.has(activeImageKey) : false;
  const txLabels = { intake: labels.intake, distribute: labels.distribute, adjust: labels.adjust };

  useEffect(() => {
    setImageIndex(0);
    setBrokenImages(new Set());
  }, [item?.id]);

  return (
    <Modal opened={opened} onClose={onClose} title={item?.name ?? ""} size="xl" classNames={{ content: "storage-modal-content", header: "storage-modal-header", body: "storage-modal-body" }}>
      {item ? (
        <div className="storage-detail">
          <aside className="storage-detail-media">
            {activeImage && !imageIsBroken ? (
              <Image
                src={resolveImageUrl(activeImage.r2_key)}
                alt={item.name}
                fit="contain"
                className="storage-detail-media__image"
                onError={() => setBrokenImages((current) => new Set(current).add(activeImage.r2_key))}
              />
            ) : imageIsBroken ? (
              <div className="storage-detail-media__empty storage-detail-media__empty--broken"><PhotoOffIcon size={48} /></div>
            ) : (
              <div className="storage-detail-media__empty"><PhotoOffIcon size={44} /></div>
            )}
            {item.images.length > 1 ? (
              <Group justify="center" mt={8}>
                <ActionIcon variant="default" onClick={() => setImageIndex((value) => (value <= 0 ? item.images.length - 1 : value - 1))}>
                  <ChevronLeftIcon size={16} />
                </ActionIcon>
                <Text size="xs">{imageIndex + 1} / {item.images.length}</Text>
                <ActionIcon variant="default" onClick={() => setImageIndex((value) => (value + 1) % item.images.length)}>
                  <ChevronRightIcon size={16} />
                </ActionIcon>
              </Group>
            ) : null}
            <div className="storage-detail-media__meta">
              <Text size="xs" c="dimmed">{labels.stock}</Text>
              <Text fw={900}>{item.quantity}</Text>
            </div>
          </aside>
          <Stack gap="sm" className="storage-detail__content">
            <section className="storage-detail__panel storage-detail__panel--summary">
              <Group gap={8}>
                <Badge color={item.quantity > 0 ? "green" : "gray"}>{labels.stock}: {item.quantity}</Badge>
                {item.allow_member_deposit ? <Badge variant="light" color="green">{labels.intake}</Badge> : null}
                {item.allow_member_withdraw ? <Badge variant="light" color="portal-bronze">{labels.distribute}</Badge> : null}
              </Group>
              <Text size="sm" fw={800} mt={12}>{labels.description}</Text>
              <Text size="sm" c={item.description ? undefined : "dimmed"}>{item.description || labels.noDescription}</Text>
            </section>
            <section className="storage-detail__panel">
              <Text size="sm" fw={800} mb={10}>{labels.ledger}</Text>
              {transactions.length > 0 ? (
                <div className="storage-ledger">
                  {transactions.map((tx) => (
                    <div key={tx.id} className={`storage-ledger-row ${txClassName(tx.type)}`}>
                      <div className="storage-ledger-row__main">
                        <Group justify="space-between" gap={8} wrap="nowrap">
                          <Group gap={6} wrap="nowrap">
                            <Badge variant="light">{txLabels[tx.type]}</Badge>
                            <Text fw={900} className="storage-ledger-row__delta">{tx.quantity_delta > 0 ? "+" : ""}{tx.quantity_delta}</Text>
                          </Group>
                          <Text size="xs" c="dimmed">{formatDateTime(tx.created_at)}</Text>
                        </Group>
                        <Text size="xs" c="dimmed" mt={5}>
                          {labels.actor}: {tx.actor_username ?? tx.actor_id}
                          {tx.recipient_username ? ` / ${labels.recipient}: ${tx.recipient_username}` : ""}
                        </Text>
                        {tx.note ? <Text size="sm" mt={5}>{tx.note}</Text> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="sm" c="dimmed">{labels.emptyLedger}</Text>
              )}
            </section>
          </Stack>
        </div>
      ) : null}
    </Modal>
  );
}
