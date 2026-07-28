// Domain: Guild Storage (仓库)
// Tables: storages, storage_categories, storage_items, storage_item_images, storage_transactions
// Dependencies: auth.users
//
// Invariant: every stock mutation and its storage_transactions insert share
// one atomic D1 batch, so SUM(quantity_delta) per item === current quantity.
// recipient_user_id is SET NULL (not cascade) so deleting a user keeps the
// ledger row. No sort_order columns — ordering is a frontend concern.
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
  (table) => [
    index("idx_storage_items_storage_name_id").on(table.storageId, table.name, table.id),
    index("idx_storage_items_storage_category_name_id").on(table.storageId, table.categoryId, table.name, table.id),
    check("storage_items_quantity_nonnegative", sql`${table.quantity} >= 0`),
  ],
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
    type: text("type", { enum: ["intake", "distribute", "adjust"] }).notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    actorId: text("actor_id").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => ({
    idxItem: index("idx_storage_transactions_item").on(table.itemId, table.createdAt),
    // Partial: only distribute rows carry a recipient; intake/adjust rows are NULL.
    idxRecipient: index("idx_storage_transactions_recipient")
      .on(table.recipientUserId, table.createdAt)
      .where(sql`${table.recipientUserId} IS NOT NULL`),
    // Guild-wide recent-activity ledger. created_at is not unique — queries
    // MUST tie-break: ORDER BY created_at DESC, id DESC.
    idxCreated: index("idx_storage_transactions_created").on(table.createdAt),
  }),
);
