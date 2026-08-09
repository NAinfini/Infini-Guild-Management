import { storageItemSchema, storageSchema, storageTransactionSchema } from "@guild/shared";
import { storageCategories, storageItems, storageTransactions, storages } from "../db/schema";

export type StorageItemRow = typeof storageItems.$inferSelect;
export type StorageImageRow = { mediaId: string };
export type StorageRow = typeof storages.$inferSelect;
export type CategoryRow = typeof storageCategories.$inferSelect;
type TxType = typeof storageTransactions.type.enumValues[number];

export type TransactionJoinedRow = {
  id: string;
  itemId: string;
  itemName: string | null;
  type: TxType;
  quantityDelta: number;
  recipientUserId: string | null;
  recipientUsername: string | null;
  note: string | null;
  actorId: string;
  actorUsername: string | null;
  createdAt: string;
};

export function toStoragePayload(row: StorageRow, categories: CategoryRow[]) {
  return storageSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.createdAt,
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
  });
}

export function toItemPayload(row: StorageItemRow, images: StorageImageRow[] = []) {
  return storageItemSchema.parse({
    id: row.id,
    storage_id: row.storageId,
    category_id: row.categoryId,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    allow_member_deposit: row.allowMemberDeposit,
    allow_member_withdraw: row.allowMemberWithdraw,
    images: images.map((image) => ({ media_id: image.mediaId })),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export function toTransactionPayload(row: TransactionJoinedRow) {
  return storageTransactionSchema.parse({
    id: row.id,
    item_id: row.itemId,
    item_name: row.itemName,
    type: row.type,
    quantity_delta: row.quantityDelta,
    recipient_user_id: row.recipientUserId,
    recipient_username: row.recipientUsername,
    note: row.note,
    actor_id: row.actorId,
    actor_username: row.actorUsername,
    created_at: row.createdAt,
  });
}
