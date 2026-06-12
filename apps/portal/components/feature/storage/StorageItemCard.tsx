import type { StorageCategory, StorageItem } from "@guild/shared";
import { ActionIcon, Badge, Button, Group, Image, Text } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PhotoOffIcon } from "@portal/components/icons";
import { useState } from "react";
import { PortalCard } from "../../shared/PortalCard";

type StorageItemCardProps = {
  item: StorageItem;
  category?: StorageCategory;
  imageUrl?: string;
  canEditItems: boolean;
  onOpen: (item: StorageItem) => void;
  onDeposit: (item: StorageItem) => void;
  onWithdraw: (item: StorageItem) => void;
  onEdit: (item: StorageItem) => void;
  labels: {
    deposit: string;
    withdraw: string;
    edit: string;
    uncategorized: string;
    stock: string;
    depositEnabled: string;
    withdrawEnabled: string;
    closed: string;
  };
};

export function StorageItemCard({
  item,
  category,
  imageUrl,
  canEditItems,
  onOpen,
  onDeposit,
  onWithdraw,
  onEdit,
  labels,
}: StorageItemCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <PortalCard className="storage-item-card" interactive={false}>
      <button type="button" className="storage-item-card__preview" onClick={() => onOpen(item)} aria-label={item.name}>
        {imageUrl && !imageFailed ? (
          <Image src={imageUrl} alt={item.name} fit="cover" className="storage-item-card__image" onError={() => setImageFailed(true)} />
        ) : imageFailed ? (
          <span className="storage-item-card__placeholder storage-item-card__placeholder--broken"><PhotoOffIcon size={28} /></span>
        ) : (
          <span className="storage-item-card__placeholder"><PhotoOffIcon size={28} /></span>
        )}
      </button>
      <div className="storage-item-card__body">
        <div className="storage-item-card__main">
          <div className="storage-item-card__title-row">
            <Text fw={800} lineClamp={1}>{item.name}</Text>
            <span className={`storage-item-card__stock ${item.quantity > 0 ? "storage-item-card__stock--available" : ""}`}>
              {item.quantity}
            </span>
          </div>
          <Group gap={6} className="storage-item-card__badges">
            <Badge variant="light" color="gray">{category?.name ?? labels.uncategorized}</Badge>
            {item.allow_member_deposit ? <Badge variant="light" color="green">{labels.depositEnabled}</Badge> : null}
            {item.allow_member_withdraw ? <Badge variant="light" color="blue">{labels.withdrawEnabled}</Badge> : null}
            {!item.allow_member_deposit && !item.allow_member_withdraw ? <Badge variant="light" color="gray">{labels.closed}</Badge> : null}
          </Group>
        </div>
        <Group gap={6} className="storage-item-card__actions">
          {item.allow_member_deposit ? (
            <Button size="compact-xs" variant="light" leftSection={<ArrowDownIcon size={13} />} onClick={() => onDeposit(item)}>
              {labels.deposit}
            </Button>
          ) : null}
          {item.allow_member_withdraw ? (
            <Button size="compact-xs" variant="light" leftSection={<ArrowUpIcon size={13} />} onClick={() => onWithdraw(item)} disabled={item.quantity <= 0}>
              {labels.withdraw}
            </Button>
          ) : null}
          {canEditItems ? (
            <ActionIcon size={30} variant="subtle" onClick={() => onEdit(item)} aria-label={labels.edit}>
              <PencilIcon size={15} />
            </ActionIcon>
          ) : null}
        </Group>
      </div>
    </PortalCard>
  );
}
