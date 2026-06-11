// Domain: Guild Storage (仓库)
// Tables: storages, storage_categories, storage_items, storage_item_images, storage_transactions
// Dependencies: auth.users
//
// Invariant: storage_items.quantity changes ONLY via an atomic
// "UPDATE quantity + INSERT storage_transactions" D1 batch, so the ledger
// reconciles: SUM(quantity_delta) per item === current quantity.
// recipient_user_id is SET NULL (not cascade) so deleting a user keeps the
// ledger row. No sort_order columns — ordering is a frontend concern.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { nowUtc } from "./shared";

export const storages = sqliteTable("storages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull().default(nowUtc),
});

export const storageCategories = sqliteTable(
  "storage_categories",
  {
    id: text("id").primaryKey(),
    storageId: text("storage_id").notNull().references(() => storages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxStorage: index("idx_storage_categories_storage").on(table.storageId),
  }),
);

export const storageItems = sqliteTable(
  "storage_items",
  {
    id: text("id").primaryKey(),
    storageId: text("storage_id").notNull().references(() => storages.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => storageCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull().default(0),
    // Per-item member self-service flags
    allowMemberDeposit: integer("allow_member_deposit", { mode: "boolean" }).notNull().default(false),
    allowMemberWithdraw: integer("allow_member_withdraw", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxStorage: index("idx_storage_items_storage").on(table.storageId, table.categoryId),
  }),
);

export const storageItemImages = sqliteTable(
  "storage_item_images",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => storageItems.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc), // display order = createdAt, id
  },
  (table) => ({
    idxItem: index("idx_storage_item_images_item").on(table.itemId),
  }),
);

export const storageTransactions = sqliteTable(
  "storage_transactions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => storageItems.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // intake | distribute | adjust
    quantityDelta: integer("quantity_delta").notNull(),
    recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    actorId: text("actor_id").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxItem: index("idx_storage_tx_item").on(table.itemId, table.createdAt),
    idxRecipient: index("idx_storage_tx_recipient").on(table.recipientUserId, table.createdAt),
  }),
);
