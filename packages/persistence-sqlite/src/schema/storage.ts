import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

const nowUtc = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const storages = sqliteTable("storages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull().default(nowUtc),
}, (table) => [
  check("storages_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 50`),
  check("storages_description_valid", sql`${table.description} IS NULL OR length(${table.description}) <= 500`),
  index("idx_storages_name_id").on(table.name, table.id),
]);

export const storageCategories = sqliteTable("storage_categories", {
  id: text("id").primaryKey(),
  storageId: text("storage_id").notNull().references(() => storages.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(nowUtc),
}, (table) => [
  check("storage_categories_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 50`),
  uniqueIndex("ux_storage_categories_storage_id").on(table.storageId, table.id),
  index("idx_storage_categories_storage_name_id").on(table.storageId, table.name, table.id),
]);

export const storageItems = sqliteTable("storage_items", {
  id: text("id").primaryKey(),
  storageId: text("storage_id").notNull().references(() => storages.id, { onDelete: "restrict" }),
  categoryId: text("category_id"),
  name: text("name").notNull(),
  description: text("description"),
  allowMemberDeposit: integer("allow_member_deposit", { mode: "boolean" }).notNull().default(false),
  allowMemberWithdraw: integer("allow_member_withdraw", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(nowUtc),
  updatedAt: text("updated_at").notNull().default(nowUtc),
}, (table) => [
  foreignKey({
    name: "storage_items_category_same_storage_fk",
    columns: [table.storageId, table.categoryId],
    foreignColumns: [storageCategories.storageId, storageCategories.id],
  }).onDelete("restrict"),
  check("storage_items_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 100`),
  check("storage_items_description_valid", sql`${table.description} IS NULL OR length(${table.description}) <= 2000`),
  check(
    "storage_items_self_service_flags_valid",
    sql`${table.allowMemberDeposit} IN (0, 1) AND ${table.allowMemberWithdraw} IN (0, 1)`,
  ),
  index("idx_storage_items_storage_name_id").on(table.storageId, table.name, table.id),
  index("idx_storage_items_storage_category_name_id").on(
    table.storageId,
    table.categoryId,
    table.name,
    table.id,
  ),
  index("idx_storage_items_category_name_id").on(table.categoryId, table.name, table.id),
  index("idx_storage_items_member_deposit")
    .on(table.storageId, table.name, table.id)
    .where(sql`${table.allowMemberDeposit} = 1`),
  index("idx_storage_items_member_withdraw")
    .on(table.storageId, table.name, table.id)
    .where(sql`${table.allowMemberWithdraw} = 1`),
]);

export const storageBalances = sqliteTable("storage_balances", {
  itemId: text("item_id").primaryKey().references(() => storageItems.id, { onDelete: "cascade" }),
  quantity: real("quantity").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(nowUtc),
}, (table) => [
  check(
    "storage_balances_quantity_valid",
    sql`typeof(${table.quantity}) IN ('integer', 'real') AND ${table.quantity} >= 0 AND abs(${table.quantity}) < 1e308`,
  ),
  index("idx_storage_balances_quantity_item").on(table.quantity, table.itemId),
]);

export const storageBatches = sqliteTable("storage_batches", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key"),
  accessMode: text("access_mode", { enum: ["stock_admin", "member_self"] }).notNull(),
  transactionType: text("transaction_type", { enum: ["intake", "distribute", "adjust"] }).notNull(),
  recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: text("created_at").notNull().default(nowUtc),
}, (table) => [
  check("storage_batches_access_mode_valid", sql`${table.accessMode} IN ('stock_admin', 'member_self')`),
  check("storage_batches_transaction_type_valid", sql`${table.transactionType} IN ('intake', 'distribute', 'adjust')`),
  check(
    "storage_batches_recipient_valid",
    sql`${table.transactionType} <> 'adjust' OR ${table.recipientUserId} IS NULL`,
  ),
  check(
    "storage_batches_member_self_valid",
    sql`${table.accessMode} = 'stock_admin'
      OR (${table.transactionType} IN ('intake', 'distribute') AND ${table.recipientUserId} = ${table.actorId})`,
  ),
  check("storage_batches_note_valid", sql`${table.note} IS NULL OR length(${table.note}) <= 200`),
  check(
    "storage_batches_idempotency_key_valid",
    sql`${table.idempotencyKey} IS NULL OR (
      length(${table.idempotencyKey}) BETWEEN 16 AND 64
      AND substr(${table.idempotencyKey}, 1, 1) GLOB '[A-Za-z0-9]'
      AND ${table.idempotencyKey} NOT GLOB '*[^-A-Za-z0-9._:]*'
    )`,
  ),
  uniqueIndex("ux_storage_batches_actor_idempotency")
    .on(table.actorId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("idx_storage_batches_actor_created_id").on(table.actorId, table.createdAt, table.id),
  index("idx_storage_batches_recipient_created_id")
    .on(table.recipientUserId, table.createdAt, table.id)
    .where(sql`${table.recipientUserId} IS NOT NULL`),
]);

export const storageLedgerEntries = sqliteTable("storage_ledger_entries", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => storageItems.id, { onDelete: "restrict" }),
  batchId: text("batch_id").notNull().references(() => storageBatches.id, { onDelete: "restrict" }),
  batchPosition: integer("batch_position").notNull(),
  type: text("type", { enum: ["intake", "distribute", "adjust"] }).notNull(),
  quantityDelta: real("quantity_delta").notNull(),
  recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(nowUtc),
}, (table) => [
  check("storage_ledger_type_valid", sql`${table.type} IN ('intake', 'distribute', 'adjust')`),
  check(
    "storage_ledger_quantity_valid",
    sql`typeof(${table.quantityDelta}) IN ('integer', 'real')
      AND ${table.quantityDelta} <> 0
      AND abs(${table.quantityDelta}) <= 1000000
      AND abs(${table.quantityDelta}) < 1e308`,
  ),
  check(
    "storage_ledger_quantity_sign_valid",
    sql`(${table.type} = 'intake' AND ${table.quantityDelta} > 0)
      OR (${table.type} = 'distribute' AND ${table.quantityDelta} < 0)
      OR (${table.type} = 'adjust' AND ${table.quantityDelta} <> 0)`,
  ),
  check("storage_ledger_batch_position_valid", sql`${table.batchPosition} BETWEEN 0 AND 19`),
  check("storage_ledger_note_valid", sql`${table.note} IS NULL OR length(${table.note}) <= 200`),
  uniqueIndex("ux_storage_ledger_batch_position").on(table.batchId, table.batchPosition),
  uniqueIndex("ux_storage_ledger_batch_item").on(table.batchId, table.itemId),
  index("idx_storage_ledger_created_id").on(table.createdAt, table.id),
  index("idx_storage_ledger_item_created_id").on(table.itemId, table.createdAt, table.id),
  index("idx_storage_ledger_actor_created_id").on(table.actorId, table.createdAt, table.id),
  index("idx_storage_ledger_recipient_created_id")
    .on(table.recipientUserId, table.createdAt, table.id)
    .where(sql`${table.recipientUserId} IS NOT NULL`),
]);
