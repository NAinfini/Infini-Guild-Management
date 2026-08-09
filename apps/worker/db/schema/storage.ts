// Domain: Guild Storage (仓库)
// Tables: storages, storage_categories, storage_items, storage_batches, storage_transactions
// Dependencies: auth.users
//
// Invariant: every stock mutation and its storage_transactions insert share
// one atomic D1 batch, so SUM(quantity_delta) per item === current quantity.
// recipient_user_id is SET NULL (not cascade) so deleting a user keeps the
// ledger row. No sort_order columns — ordering is a frontend concern.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  (table) => [
    index("idx_storage_categories_storage").on(table.storageId),
    uniqueIndex("ux_storage_categories_storage_id").on(table.storageId, table.id),
  ],
);

export const storageItems = sqliteTable(
  "storage_items",
  {
    id: text("id").primaryKey(),
    storageId: text("storage_id").notNull().references(() => storages.id, { onDelete: "cascade" }),
    categoryId: text("category_id"),
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
    foreignKey({
      name: "storage_items_category_same_storage_fk",
      columns: [table.storageId, table.categoryId],
      foreignColumns: [storageCategories.storageId, storageCategories.id],
    }).onDelete("restrict"),
    check("storage_items_quantity_nonnegative", sql`${table.quantity} >= 0`),
    check(
      "storage_items_boolean_flags_valid",
      sql`${table.allowMemberDeposit} IN (0, 1) AND ${table.allowMemberWithdraw} IN (0, 1)`,
    ),
  ],
);

export const storageBatches = sqliteTable(
  "storage_batches",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    uniqueIndex("ux_storage_batches_id_actor").on(table.id, table.actorId),
    index("idx_storage_batches_actor_created").on(table.actorId, table.createdAt, table.id),
    check(
      "storage_batches_id_valid",
      sql`length(${table.id}) = 78 AND substr(${table.id}, 1, 14) = 'storage-batch-' AND substr(${table.id}, 15) NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const storageTransactions = sqliteTable(
  "storage_transactions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => storageItems.id, { onDelete: "restrict" }),
    type: text("type", { enum: ["intake", "distribute", "adjust"] }).notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    batchId: text("batch_id"),
    batchPosition: integer("batch_position"),
    createdAt: text("created_at").notNull().default(nowUtc),
  },
  (table) => [
    index("idx_storage_transactions_item").on(table.itemId, table.createdAt, table.id),
    // Partial: only distribute rows carry a recipient; intake/adjust rows are NULL.
    index("idx_storage_transactions_recipient")
      .on(table.recipientUserId, table.createdAt, table.id)
      .where(sql`${table.recipientUserId} IS NOT NULL`),
    // Guild-wide recent-activity ledger. created_at is not unique — queries
    // MUST tie-break: ORDER BY created_at DESC, id DESC.
    index("idx_storage_transactions_created").on(table.createdAt, table.id),
    index("idx_storage_transactions_actor").on(table.actorId, table.createdAt, table.id),
    uniqueIndex("ux_storage_transactions_batch_position").on(table.batchId, table.batchPosition),
    uniqueIndex("ux_storage_transactions_batch_item").on(table.batchId, table.itemId),
    foreignKey({
      name: "storage_transactions_batch_actor_fk",
      columns: [table.batchId, table.actorId],
      foreignColumns: [storageBatches.id, storageBatches.actorId],
    }).onDelete("restrict"),
    check("storage_transactions_type_valid", sql`${table.type} IN ('intake', 'distribute', 'adjust')`),
    check("storage_transactions_quantity_nonzero", sql`${table.quantityDelta} <> 0`),
    check(
      "storage_transactions_quantity_sign_valid",
      sql`(${table.type} = 'intake' AND ${table.quantityDelta} > 0) OR (${table.type} = 'distribute' AND ${table.quantityDelta} < 0) OR (${table.type} = 'adjust' AND ${table.quantityDelta} <> 0)`,
    ),
    check(
      "storage_transactions_batch_pair_valid",
      sql`(${table.batchId} IS NULL AND ${table.batchPosition} IS NULL) OR (${table.batchId} IS NOT NULL AND ${table.batchPosition} IS NOT NULL AND ${table.batchPosition} >= 0)`,
    ),
  ],
);
