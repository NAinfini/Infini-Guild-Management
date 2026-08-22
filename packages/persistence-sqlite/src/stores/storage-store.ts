import type {
  NormalizedStockRequest,
  StockCommit,
  StockSubmissionEntry,
  StockSubmissionSnapshot,
  StorageDeleteResult,
  StorageItemRecord,
  StorageLedgerQuery,
  StorageMediaPort,
  StoragePlacement,
  StorageStore,
  StoredStorageBatch,
} from "@guild/server/modules/storage";
import { LIMITS, lowercaseLikePattern } from "@guild/shared";
import type { MediaService } from "@guild/server/modules/media";
import { AppError } from "@guild/kernel";
import type {
  CursorResponse,
  PaginatedResponse,
  Storage,
  StorageCategory,
  StorageItemsListQuery,
  StorageTransaction,
} from "@guild/shared";
import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../database.js";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlRow, SqlValue } from "@guild/kernel";
import { storageBalances, storageCategories, storageItems, storageLedgerEntries, storages } from "../schema/storage.js";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { StorageStoreError } from "@guild/server/modules/storage";
import { returnedRowCount } from "./sql-result.js";

type StorageSchema = {
  storageBalances: typeof storageBalances;
  storageCategories: typeof storageCategories;
  storageItems: typeof storageItems;
  storageLedgerEntries: typeof storageLedgerEntries;
  storages: typeof storages;
};

type ItemSelectRow = {
  id: string;
  storageId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  allowMemberDeposit: boolean;
  allowMemberWithdraw: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StorageMediaLimits = Readonly<{
  maxImageBytes: number;
  maxImagesPerItem: number;
}>;

/** Storage's production adapter over the shared media upload service and media_links lifecycle. */
export class SqliteStorageMediaPort implements StorageMediaPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly media: Pick<MediaService, "uploadImages">,
    private readonly getLimits: () => Promise<StorageMediaLimits>,
  ) {}

  async listItemMediaIds(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) return new Map();
    if (uniqueItemIds.length > 100) throw new RangeError("Storage media reads support at most 100 items");
    const result = await this.sql.execute({
      method: "all",
      sql: `SELECT entity_id, media_id
        FROM media_links
        WHERE entity_type = 'storage_item'
          AND slot = 'image'
          AND entity_id IN (${uniqueItemIds.map(() => "?").join(", ")})
        ORDER BY entity_id ASC, sort_order ASC`,
      params: uniqueItemIds,
    });
    const byItem = new Map<string, string[]>(uniqueItemIds.map((itemId) => [itemId, []]));
    for (const row of allRows(result)) {
      byItem.get(stringValue(row[0]))?.push(stringValue(row[1]));
    }
    return byItem;
  }

  async attachItemImages(
    input: Parameters<StorageMediaPort["attachItemImages"]>[0],
  ): Promise<readonly string[]> {
    const actor = input.context.authorization.requireAuthenticated();
    const limits = await this.getLimits();
    const existing = [...((await this.listItemMediaIds([input.itemId])).get(input.itemId) ?? [])];
    if (existing.length + input.uploads.length > limits.maxImagesPerItem) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        status: 400,
        message: `Storage items support at most ${limits.maxImagesPerItem} images`,
      });
    }
    const uploaded = await this.media.uploadImages(
      input.context,
      "storage_image",
      input.uploads,
      limits.maxImageBytes,
    );
    const desired = [...existing, ...uploaded];
    await assertMediaAttachments(this.sql, {
      actorUserId: actor.userId,
      entityType: "storage_item",
      entityId: input.itemId,
      slot: "image",
      purpose: "storage_image",
      audience: "authenticated",
      mediaIds: desired,
      maxItems: limits.maxImagesPerItem,
    });
    await this.sql.batch([
      ...replaceMediaLinksStatements({
        entityType: "storage_item",
        entityId: input.itemId,
        slot: "image",
        audience: "authenticated",
        mediaIds: desired,
      }, {
        sql: "SELECT 1 FROM storage_items WHERE id = ?",
        params: [input.itemId],
      }),
      auditInsertStatement(input.audit, {
        sql: "SELECT 1 FROM storage_items WHERE id = ?",
        params: [input.itemId],
      }),
    ]);
    return uploaded;
  }

  async detachItemImage(input: Parameters<StorageMediaPort["detachItemImage"]>[0]): Promise<boolean> {
    input.context.authorization.requireAuthenticated();
    const results = await this.sql.batch([
      auditInsertStatement(input.audit, {
        sql: `SELECT 1 FROM media_links
          WHERE media_id = ? AND entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'`,
        params: [input.mediaId, input.itemId],
      }),
      {
        method: "get",
        sql: `DELETE FROM media_links
          WHERE media_id = ? AND entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING media_id AS media_id`,
        params: [input.mediaId, input.itemId, input.audit.eventId],
        columns: ["media_id"],
      },
    ]);
    return returnedRowCount(results[1]) === 1;
  }
}

export class SqliteStorageStore implements StorageStore {
  constructor(
    private readonly db: AppDatabase<StorageSchema>,
    private readonly sql: SqlExecutor,
  ) {}

  async getTree(): Promise<{ data: Storage[] }> {
    const storageLimit = LIMITS.content.storageStructure.storages.max;
    const categoryLimit = LIMITS.content.storageStructure.categories.max;
    const [storageRows, categoryRows] = await Promise.all([
      this.db.select().from(storages).orderBy(asc(storages.name), asc(storages.id)).limit(storageLimit + 1),
      this.db.select().from(storageCategories).orderBy(
        asc(storageCategories.storageId),
        asc(storageCategories.name),
        asc(storageCategories.id),
      ).limit(categoryLimit + 1),
    ]);
    if (storageRows.length > storageLimit || categoryRows.length > categoryLimit) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Storage structure data invariant violated" });
    }
    const byStorage = new Map<string, StorageCategory[]>();
    for (const category of categoryRows) {
      const list = byStorage.get(category.storageId) ?? [];
      list.push({ id: category.id, name: category.name });
      byStorage.set(category.storageId, list);
    }
    return {
      data: storageRows.map((storage) => ({
        id: storage.id,
        name: storage.name,
        description: storage.description,
        created_at: storage.createdAt,
        categories: byStorage.get(storage.id) ?? [],
      })),
    };
  }

  async createStorage(input: Readonly<{ storage: Storage; audit: Parameters<typeof auditInsertStatement>[0] }>) {
    const results = await this.sql.batch([{
      method: "all",
      columns: ["storage_id"],
      sql: `INSERT INTO storages (id, name, description, created_at)
        SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM storages) < ?
        RETURNING id AS storage_id`,
      params: [
        input.storage.id,
        input.storage.name,
        input.storage.description,
        input.storage.created_at,
        LIMITS.content.storageStructure.storages.max,
      ],
    }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
    return returnedRowCount(results[0]) === 1 ? "created" as const : "limit_reached" as const;
  }

  async updateStorage(input: Parameters<StorageStore["updateStorage"]>[0]): Promise<Storage | null> {
    const existing = await this.db.select().from(storages).where(eq(storages.id, input.id)).limit(1);
    if (!existing[0]) return null;
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const differences: string[] = [];
    const differenceParams: SqlValue[] = [];
    if (input.patch.name !== undefined) {
      assignments.push("name = ?");
      params.push(input.patch.name);
      differences.push("name IS NOT ?");
      differenceParams.push(input.patch.name);
    }
    if (input.patch.description !== undefined) {
      assignments.push("description = ?");
      params.push(input.patch.description);
      differences.push("description IS NOT ?");
      differenceParams.push(input.patch.description);
    }
    if (differences.length > 0) {
      params.push(input.id, ...differenceParams);
      await this.sql.batch([{
        method: "all",
        columns: ["storage_id"],
        sql: `UPDATE storages SET ${assignments.join(", ")}
          WHERE id = ? AND (${differences.join(" OR ")})
          RETURNING id AS storage_id`,
        params,
      }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
    }
    const categories = await this.db.select().from(storageCategories)
      .where(eq(storageCategories.storageId, input.id))
      .orderBy(asc(storageCategories.name), asc(storageCategories.id))
      .limit(LIMITS.content.storageStructure.categories.max + 1);
    if (categories.length > LIMITS.content.storageStructure.categories.max) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Storage category data invariant violated" });
    }
    const row = (await this.db.select().from(storages).where(eq(storages.id, input.id)).limit(1))[0];
    return row ? {
      id: row.id,
      name: row.name,
      description: row.description,
      created_at: row.createdAt,
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
    } : null;
  }

  async deleteStorage(id: string, audit: Parameters<typeof auditInsertStatement>[0]): Promise<StorageDeleteResult> {
    const exists = (await this.db.select({ id: storages.id }).from(storages).where(eq(storages.id, id)).limit(1))[0];
    if (!exists) return "not_found";
    const item = (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.storageId, id)).limit(1))[0];
    if (item) return "not_empty";
    const results = await this.sql.batch([auditInsertStatement(audit, {
      sql: "SELECT 1 FROM storages WHERE id = ? AND NOT EXISTS (SELECT 1 FROM storage_items WHERE storage_id = ?)",
      params: [id, id],
    }), {
      method: "get",
      sql: `DELETE FROM storages
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM storage_items WHERE storage_id = ?)
          AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
        RETURNING id AS storage_id`,
      params: [id, id, audit.eventId],
      columns: ["storage_id"],
    }]);
    if (returnedRowCount(results[1]) === 1) return "deleted";
    return (await this.db.select({ id: storages.id }).from(storages).where(eq(storages.id, id)).limit(1))[0]
      ? "not_empty"
      : "not_found";
  }

  async createCategory(input: Parameters<StorageStore["createCategory"]>[0]): Promise<StoragePlacement> {
    const storage = (await this.db.select({ id: storages.id }).from(storages)
      .where(eq(storages.id, input.storageId)).limit(1))[0];
    if (!storage) return "storage_missing";
    try {
      const results = await this.sql.batch([{
        method: "all",
        columns: ["category_id"],
        sql: `INSERT INTO storage_categories (id, storage_id, name, created_at)
          SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM storage_categories) < ?
          RETURNING id AS category_id`,
        params: [
          input.category.id,
          input.storageId,
          input.category.name,
          input.createdAt,
          LIMITS.content.storageStructure.categories.max,
        ],
      }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
      return returnedRowCount(results[0]) === 1 ? "valid" : "limit_reached";
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async updateCategory(input: Parameters<StorageStore["updateCategory"]>[0]): Promise<StorageCategory | null> {
    const existing = (await this.db.select({ id: storageCategories.id }).from(storageCategories).where(and(
      eq(storageCategories.id, input.categoryId),
      eq(storageCategories.storageId, input.storageId),
    )).limit(1))[0];
    if (!existing) return null;
    const results = await this.sql.batch([{
      method: "get",
      sql: `UPDATE storage_categories SET name = ?
        WHERE id = ? AND storage_id = ? AND name IS NOT ?
        RETURNING id AS category_id`,
      params: [input.name, input.categoryId, input.storageId, input.name],
      columns: ["category_id"],
    }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
    if (returnedRowCount(results[0]) === 1) return { id: input.categoryId, name: input.name };
    const current = (await this.db.select({ id: storageCategories.id, name: storageCategories.name })
      .from(storageCategories).where(and(
        eq(storageCategories.id, input.categoryId),
        eq(storageCategories.storageId, input.storageId),
      )).limit(1))[0];
    return current ?? null;
  }

  async deleteCategory(
    storageId: string,
    categoryId: string,
    audit: Parameters<typeof auditInsertStatement>[0],
  ): Promise<StorageDeleteResult> {
    const category = (await this.db.select({ id: storageCategories.id }).from(storageCategories).where(and(
      eq(storageCategories.id, categoryId),
      eq(storageCategories.storageId, storageId),
    )).limit(1))[0];
    if (!category) return "not_found";
    const item = (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.categoryId, categoryId)).limit(1))[0];
    if (item) return "not_empty";
    const results = await this.sql.batch([auditInsertStatement(audit, {
      sql: `SELECT 1 FROM storage_categories
        WHERE id = ? AND storage_id = ?
          AND NOT EXISTS (SELECT 1 FROM storage_items WHERE category_id = ?)`,
      params: [categoryId, storageId, categoryId],
    }), {
      method: "get",
      sql: `DELETE FROM storage_categories
        WHERE id = ? AND storage_id = ?
          AND NOT EXISTS (SELECT 1 FROM storage_items WHERE category_id = ?)
          AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
        RETURNING id AS category_id`,
      params: [categoryId, storageId, categoryId, audit.eventId],
      columns: ["category_id"],
    }]);
    if (returnedRowCount(results[1]) === 1) return "deleted";
    return (await this.db.select({ id: storageCategories.id }).from(storageCategories).where(and(
      eq(storageCategories.id, categoryId),
      eq(storageCategories.storageId, storageId),
    )).limit(1))[0] ? "not_empty" : "not_found";
  }

  async listItems(query: StorageItemsListQuery): Promise<CursorResponse<StorageItemRecord>> {
    const cursor = query.cursor ? decodeItemCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw new StorageStoreError("invalid_cursor");
    const filters: string[] = [];
    const params: SqlValue[] = [];
    if (query.storage_id) {
      filters.push("item.storage_id = ?");
      params.push(query.storage_id);
    }
    if (query.category_id) {
      filters.push("item.category_id = ?");
      params.push(query.category_id);
    }
    if (query.search) {
      filters.push("lower(item.name) LIKE ? ESCAPE '\\'");
      params.push(lowercaseLikePattern(query.search));
    }
    if (query.stock === "available") filters.push("balance.quantity > 0");
    if (query.stock === "empty") filters.push("balance.quantity = 0");
    if (query.stock === "deposit") filters.push("item.allow_member_deposit = 1");
    if (query.stock === "withdraw") filters.push("item.allow_member_withdraw = 1");
    if (cursor) {
      filters.push("(item.name > ? OR (item.name = ? AND item.id > ?))");
      params.push(cursor.name, cursor.name, cursor.id);
    }
    params.push(query.limit + 1);
    const result = await this.sql.execute({
      method: "all",
      sql: `SELECT
          item.id, item.storage_id, item.category_id, item.name, item.description,
          balance.quantity, item.allow_member_deposit, item.allow_member_withdraw,
          item.created_at, item.updated_at
        FROM storage_items AS item
        JOIN storage_balances AS balance ON balance.item_id = item.id
        ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY item.name ASC, item.id ASC
        LIMIT ?`,
      params,
    });
    const rows = allRows(result).map(itemFromSqlRow);
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data.at(-1);
    return {
      data,
      next_cursor: hasMore && last ? encodeItemCursor({ name: last.name, id: last.id }) : null,
    };
  }

  async getItem(itemId: string): Promise<StorageItemRecord | null> {
    const row = (await this.db.select({
      id: storageItems.id,
      storageId: storageItems.storageId,
      categoryId: storageItems.categoryId,
      name: storageItems.name,
      description: storageItems.description,
      quantity: storageBalances.quantity,
      allowMemberDeposit: storageItems.allowMemberDeposit,
      allowMemberWithdraw: storageItems.allowMemberWithdraw,
      createdAt: storageItems.createdAt,
      updatedAt: storageItems.updatedAt,
    }).from(storageItems).innerJoin(storageBalances, eq(storageBalances.itemId, storageItems.id))
      .where(eq(storageItems.id, itemId)).limit(1))[0] as ItemSelectRow | undefined;
    return row ? itemFromDrizzleRow(row) : null;
  }

  async validateItemPlacement(storageId: string, categoryId: string | null): Promise<StoragePlacement> {
    const storage = (await this.db.select({ id: storages.id }).from(storages)
      .where(eq(storages.id, storageId)).limit(1))[0];
    if (!storage) return "storage_missing";
    if (categoryId === null) return "valid";
    const category = (await this.db.select({ storageId: storageCategories.storageId }).from(storageCategories)
      .where(eq(storageCategories.id, categoryId)).limit(1))[0];
    if (!category) return "category_missing";
    return category.storageId === storageId ? "valid" : "category_mismatch";
  }

  async createItem(item: StorageItemRecord, audit: Parameters<typeof auditInsertStatement>[0]): Promise<void> {
    try {
      await this.sql.batch([{
        method: "run",
        sql: `INSERT INTO storage_items (
          id, storage_id, category_id, name, description,
          allow_member_deposit, allow_member_withdraw, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          item.id,
          item.storage_id,
          item.category_id,
          item.name,
          item.description,
          item.allow_member_deposit ? 1 : 0,
          item.allow_member_withdraw ? 1 : 0,
          item.created_at,
          item.updated_at,
        ],
      }, auditInsertStatement(audit)]);
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async updateItem(input: Parameters<StorageStore["updateItem"]>[0]): Promise<StorageItemRecord | null> {
    if (!await this.getItem(input.id)) return null;
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const patch = input.patch;
    if (patch.categoryId !== undefined) {
      assignments.push("category_id = ?");
      params.push(patch.categoryId);
    }
    if (patch.name !== undefined) {
      assignments.push("name = ?");
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      assignments.push("description = ?");
      params.push(patch.description);
    }
    if (patch.allowMemberDeposit !== undefined) {
      assignments.push("allow_member_deposit = ?");
      params.push(patch.allowMemberDeposit ? 1 : 0);
    }
    if (patch.allowMemberWithdraw !== undefined) {
      assignments.push("allow_member_withdraw = ?");
      params.push(patch.allowMemberWithdraw ? 1 : 0);
    }
    assignments.push("updated_at = ?");
    params.push(input.updatedAt, input.id);
    try {
      await this.sql.batch([{
        method: "run",
        sql: `UPDATE storage_items SET ${assignments.join(", ")} WHERE id = ?`,
        params,
      }, auditInsertStatement(input.audit, {
        sql: "SELECT 1 FROM storage_items WHERE id = ?",
        params: [input.id],
      })]);
    } catch (error) {
      throw mapStoreError(error);
    }
    return this.getItem(input.id);
  }

  async deleteItem(itemId: string, audit: Parameters<typeof auditInsertStatement>[0]): Promise<StorageDeleteResult> {
    const item = await this.getItem(itemId);
    if (!item) return "not_found";
    const ledger = (await this.db.select({ id: storageLedgerEntries.id }).from(storageLedgerEntries)
      .where(eq(storageLedgerEntries.itemId, itemId)).limit(1))[0];
    if (ledger) return "has_ledger";
    try {
      const results = await this.sql.batch([auditInsertStatement(audit, {
        sql: "SELECT 1 FROM storage_items WHERE id = ? AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)",
        params: [itemId, itemId],
      }), {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
            AND EXISTS (
              SELECT 1 FROM storage_items
              WHERE id = ?
                AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)
            )`,
        params: [itemId, audit.eventId, itemId, itemId],
      }, {
        method: "get",
        sql: `DELETE FROM storage_items
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING id AS item_id`,
        params: [itemId, itemId, audit.eventId],
        columns: ["item_id"],
      }]);
      if (returnedRowCount(results[2]) === 1) return "deleted";
      return (await this.getItem(itemId)) ? "has_ledger" : "not_found";
    } catch (error) {
      const mapped = mapStoreError(error);
      if (mapped.code === "foreign_key") return "has_ledger";
      throw mapped;
    }
  }

  async getSubmissionSnapshot(
    actorId: string,
    recipientUserId: string | null,
    entries: readonly StockSubmissionEntry[],
  ): Promise<StockSubmissionSnapshot> {
    const values = entries.map(() => "(?, ?, ?)").join(", ");
    const params: SqlValue[] = entries.flatMap((entry, position) => [position, entry.itemId, entry.quantity]);
    params.push(actorId, recipientUserId);
    const result = await this.sql.execute({
      method: "all",
      sql: `WITH requested(position, item_id, quantity) AS (VALUES ${values})
        SELECT
          requested.position AS request_position,
          requested.item_id AS requested_item_id,
          requested.quantity AS requested_quantity,
          item.id AS item_id,
          item.storage_id AS storage_id,
          item.category_id AS category_id,
          item.name AS item_name,
          item.description AS item_description,
          balance.quantity AS current_quantity,
          item.allow_member_deposit AS allow_member_deposit,
          item.allow_member_withdraw AS allow_member_withdraw,
          item.created_at AS item_created_at,
          item.updated_at AS item_updated_at,
          actor.id AS actor_id,
          actor.username AS actor_username,
          recipient.id AS recipient_id,
          recipient.username AS recipient_username
        FROM requested
        LEFT JOIN storage_items AS item ON item.id = requested.item_id
        LEFT JOIN storage_balances AS balance ON balance.item_id = item.id
        LEFT JOIN users AS actor ON actor.id = ?
        LEFT JOIN users AS recipient ON recipient.id = ?
        ORDER BY requested.position ASC`,
      params,
    });
    const rows = allRows(result);
    const first = rows[0];
    return {
      entries: rows.map(snapshotEntryFromRow),
      actorExists: first?.[13] !== null && first?.[13] !== undefined,
      actorUsername: nullableString(first?.[14]),
      recipientExists: recipientUserId === null || (first?.[15] !== null && first?.[15] !== undefined),
      recipientUsername: nullableString(first?.[16]),
    };
  }

  async findBatch(actorId: string, idempotencyKey: string): Promise<StoredStorageBatch | null> {
    const result = await this.sql.execute({
      method: "all",
      sql: `SELECT
          batch.id AS batch_id,
          batch.transaction_type AS transaction_type,
          batch.recipient_user_id AS recipient_user_id,
          batch.note AS batch_note,
          ledger.batch_position AS batch_position,
          ledger.id AS ledger_id,
          ledger.item_id AS item_id,
          item.name AS item_name,
          ledger.quantity_delta AS quantity_delta,
          recipient.username AS recipient_username,
          ledger.actor_id AS actor_id,
          actor.username AS actor_username,
          ledger.created_at AS created_at
        FROM storage_batches AS batch
        JOIN storage_ledger_entries AS ledger ON ledger.batch_id = batch.id
        JOIN storage_items AS item ON item.id = ledger.item_id
        JOIN users AS actor ON actor.id = ledger.actor_id
        LEFT JOIN users AS recipient ON recipient.id = ledger.recipient_user_id
        WHERE batch.actor_id = ? AND batch.idempotency_key = ?
        ORDER BY ledger.batch_position ASC`,
      params: [actorId, idempotencyKey],
    });
    const rows = allRows(result);
    if (rows.length === 0) return null;
    const first = rows[0]!;
    const type = stockType(first[1]);
    if (type === "adjust") throw new StorageStoreError("constraint");
    const recipientUserId = nullableString(first[2]);
    const note = nullableString(first[3]);
    const transactions = rows.map(transactionFromReplayRow);
    const request: NormalizedStockRequest = {
      type,
      recipientUserId,
      note,
      entries: rows.map((row, index) => {
        if (numberValue(row[4]) !== index) throw new StorageStoreError("constraint");
        const delta = numberValue(row[8]);
        return {
          itemId: stringValue(row[6]),
          quantity: type === "intake" ? delta : -delta,
        };
      }),
    };
    return { id: stringValue(first[0]), request, transactions };
  }

  async commitStock(commit: StockCommit): Promise<readonly StorageTransaction[]> {
    const statements: SqlBatchStatement[] = [{
      method: "run",
      sql: `INSERT INTO storage_batches (
        id, actor_id, idempotency_key, access_mode, transaction_type,
        recipient_user_id, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        commit.batchId,
        commit.actorId,
        commit.idempotencyKey,
        commit.accessMode,
        commit.request.type,
        commit.request.recipientUserId,
        commit.request.note,
        commit.createdAt,
      ],
    }];
    for (const [position, transaction] of commit.transactions.entries()) {
      const commonParams: SqlValue[] = [
        transaction.id,
        transaction.item_id,
        commit.batchId,
        position,
        transaction.type,
      ];
      if (commit.request.type === "adjust") {
        statements.push({
          method: "get",
          columns: ["quantity_delta"],
          sql: `INSERT INTO storage_ledger_entries (
            id, item_id, batch_id, batch_position, type, quantity_delta,
            recipient_user_id, note, actor_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ? - (SELECT quantity FROM storage_balances WHERE item_id = ?), ?, ?, ?, ?)
          RETURNING quantity_delta`,
          params: [
            ...commonParams,
            commit.targetQuantity,
            transaction.item_id,
            transaction.recipient_user_id,
            transaction.note,
            transaction.actor_id,
            transaction.created_at,
          ],
        });
      } else {
        statements.push({
          method: "run",
          sql: `INSERT INTO storage_ledger_entries (
            id, item_id, batch_id, batch_position, type, quantity_delta,
            recipient_user_id, note, actor_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            ...commonParams,
            transaction.quantity_delta,
            transaction.recipient_user_id,
            transaction.note,
            transaction.actor_id,
            transaction.created_at,
          ],
        });
      }
    }
    statements.push(auditInsertStatement(commit.audit));
    try {
      const results = await this.sql.batch(statements);
      if (commit.request.type !== "adjust") return commit.transactions;
      return commit.transactions.map((transaction, position) => ({
        ...transaction,
        quantity_delta: numberValue(getRow(results[position + 1])?.[0]),
      }));
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async listLedger(query: StorageLedgerQuery): Promise<PaginatedResponse<StorageTransaction>> {
    const count = ledgerStatement(query, true);
    const page = ledgerStatement(query, false);
    const results = await this.sql.batch([count, page]);
    const total = numberValue(getRow(results[0])?.[0]);
    const data = allRows(results[1]).map(transactionFromLedgerRow);
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}

function ledgerStatement(query: StorageLedgerQuery, count: boolean): SqlBatchStatement {
  const selectColumns = count
    ? "count(*) AS total"
    : `ledger.id AS transaction_id,
       ledger.item_id AS item_id,
       item.name AS item_name,
       ledger.type AS transaction_type,
       ledger.quantity_delta AS quantity_delta,
       ledger.recipient_user_id AS recipient_user_id,
       recipient.username AS recipient_username,
       ledger.note AS note,
       ledger.actor_id AS actor_id,
       actor.username AS actor_username,
       ledger.created_at AS created_at`;
  const columns = count
    ? ["total"]
    : [
        "transaction_id",
        "item_id",
        "item_name",
        "transaction_type",
        "quantity_delta",
        "recipient_user_id",
        "recipient_username",
        "note",
        "actor_id",
        "actor_username",
        "created_at",
      ];
  if (query.canViewAll) {
    const filters: string[] = [];
    const params: SqlValue[] = [];
    if (query.itemId) {
      filters.push("ledger.item_id = ?");
      params.push(query.itemId);
    }
    if (query.recipientUserId) {
      filters.push("ledger.recipient_user_id = ?");
      params.push(query.recipientUserId);
    }
    if (!count) params.push(query.limit, (query.page - 1) * query.limit);
    return {
      method: "all",
      columns,
      sql: `SELECT ${selectColumns}
        FROM storage_ledger_entries AS ledger
        ${count ? "" : "JOIN storage_items AS item ON item.id = ledger.item_id JOIN users AS actor ON actor.id = ledger.actor_id LEFT JOIN users AS recipient ON recipient.id = ledger.recipient_user_id"}
        ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
        ${count ? "" : "ORDER BY ledger.created_at DESC, ledger.id DESC LIMIT ? OFFSET ?"}`,
      params,
    };
  }

  const branchFilters: string[] = [];
  const branchValues: SqlValue[] = [];
  if (query.itemId) {
    branchFilters.push("ledger.item_id = ?");
    branchValues.push(query.itemId);
  }
  if (query.recipientUserId) {
    branchFilters.push("ledger.recipient_user_id = ?");
    branchValues.push(query.recipientUserId);
  }
  const tail = branchFilters.length > 0 ? ` AND ${branchFilters.join(" AND ")}` : "";
  const params: SqlValue[] = [
    query.actorId,
    ...branchValues,
    query.actorId,
    query.actorId,
    ...branchValues,
  ];
  if (!count) params.push(query.limit, (query.page - 1) * query.limit);
  return {
    method: "all",
    columns,
    sql: `WITH visible AS (
        SELECT ledger.*
        FROM storage_ledger_entries AS ledger INDEXED BY idx_storage_ledger_actor_created_id
        WHERE ledger.actor_id = ?${tail}
        UNION ALL
        SELECT ledger.*
        FROM storage_ledger_entries AS ledger INDEXED BY idx_storage_ledger_recipient_created_id
        WHERE ledger.recipient_user_id = ? AND ledger.actor_id <> ?${tail}
      )
      SELECT ${selectColumns.replaceAll("ledger.", "visible.")}
      FROM visible
      ${count ? "" : "JOIN storage_items AS item ON item.id = visible.item_id JOIN users AS actor ON actor.id = visible.actor_id LEFT JOIN users AS recipient ON recipient.id = visible.recipient_user_id"}
      ${count ? "" : "ORDER BY visible.created_at DESC, visible.id DESC LIMIT ? OFFSET ?"}`,
    params,
  };
}

function itemFromDrizzleRow(row: ItemSelectRow): StorageItemRecord {
  return {
    id: row.id,
    storage_id: row.storageId,
    category_id: row.categoryId,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    allow_member_deposit: row.allowMemberDeposit,
    allow_member_withdraw: row.allowMemberWithdraw,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function itemFromSqlRow(row: SqlRow): StorageItemRecord {
  return {
    id: stringValue(row[0]),
    storage_id: stringValue(row[1]),
    category_id: nullableString(row[2]),
    name: stringValue(row[3]),
    description: nullableString(row[4]),
    quantity: numberValue(row[5]),
    allow_member_deposit: booleanValue(row[6]),
    allow_member_withdraw: booleanValue(row[7]),
    created_at: stringValue(row[8]),
    updated_at: stringValue(row[9]),
  };
}

function snapshotEntryFromRow(row: SqlRow): StockSubmissionSnapshot["entries"][number] {
  const itemId = nullableString(row[3]);
  return {
    position: numberValue(row[0]),
    requestedItemId: stringValue(row[1]),
    requestedQuantity: numberValue(row[2]),
    item: itemId === null ? null : {
      id: itemId,
      storage_id: stringValue(row[4]),
      category_id: nullableString(row[5]),
      name: stringValue(row[6]),
      description: nullableString(row[7]),
      quantity: numberValue(row[8]),
      allow_member_deposit: booleanValue(row[9]),
      allow_member_withdraw: booleanValue(row[10]),
      created_at: stringValue(row[11]),
      updated_at: stringValue(row[12]),
    },
  };
}

function transactionFromReplayRow(row: SqlRow): StorageTransaction {
  return {
    id: stringValue(row[5]),
    item_id: stringValue(row[6]),
    item_name: nullableString(row[7]),
    type: stockType(row[1]),
    quantity_delta: numberValue(row[8]),
    recipient_user_id: nullableString(row[2]),
    recipient_username: nullableString(row[9]),
    note: nullableString(row[3]),
    actor_id: stringValue(row[10]),
    actor_username: nullableString(row[11]),
    created_at: stringValue(row[12]),
  };
}

function transactionFromLedgerRow(row: SqlRow): StorageTransaction {
  return {
    id: stringValue(row[0]),
    item_id: stringValue(row[1]),
    item_name: nullableString(row[2]),
    type: stockType(row[3]),
    quantity_delta: numberValue(row[4]),
    recipient_user_id: nullableString(row[5]),
    recipient_username: nullableString(row[6]),
    note: nullableString(row[7]),
    actor_id: stringValue(row[8]),
    actor_username: nullableString(row[9]),
    created_at: stringValue(row[10]),
  };
}

function mapStoreError(error: unknown): StorageStoreError {
  if (error instanceof StorageStoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("storage_balance_no_change")) return new StorageStoreError("no_change", { cause: error });
  if (message.includes("storage_balance_delta_too_small")) {
    return new StorageStoreError("ineffective_delta", { cause: error });
  }
  if (message.includes("storage_balance_negative")) return new StorageStoreError("negative_balance", { cause: error });
  if (message.includes("storage_ledger_authorization_invalid")) {
    return new StorageStoreError("authorization_changed", { cause: error });
  }
  if (message.includes("storage_batches.actor_id, storage_batches.idempotency_key")) {
    return new StorageStoreError("idempotency_conflict", { cause: error });
  }
  if (message.includes("FOREIGN KEY constraint failed")) return new StorageStoreError("foreign_key", { cause: error });
  return new StorageStoreError("constraint", { cause: error });
}

function allRows(result: SqlResult | undefined): readonly SqlRow[] {
  if (!result || result.rows === undefined) return [];
  if (!Array.isArray(result.rows)) return [];
  if (result.rows.length === 0) return [];
  return Array.isArray(result.rows[0]) ? result.rows as readonly SqlRow[] : [result.rows as SqlRow];
}

function getRow(result: SqlResult | undefined): SqlRow | undefined {
  if (!result || result.rows === undefined) return undefined;
  if (!Array.isArray(result.rows)) return undefined;
  return Array.isArray(result.rows[0]) ? (result.rows as readonly SqlRow[])[0] : result.rows as SqlRow;
}

function stringValue(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw new StorageStoreError("constraint");
  return value;
}

function nullableString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value);
}

function numberValue(value: SqlValue | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new StorageStoreError("constraint");
  return value;
}

function booleanValue(value: SqlValue | undefined): boolean {
  const number = numberValue(value);
  if (number !== 0 && number !== 1) throw new StorageStoreError("constraint");
  return number === 1;
}

function stockType(value: SqlValue | undefined): "intake" | "distribute" | "adjust" {
  const type = stringValue(value);
  if (type !== "intake" && type !== "distribute" && type !== "adjust") {
    throw new StorageStoreError("constraint");
  }
  return type;
}

type ItemCursor = { name: string; id: string };

function encodeItemCursor(cursor: ItemCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeItemCursor(value: string): ItemCursor | null {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (Object.keys(candidate).length !== 2 || typeof candidate.name !== "string" || typeof candidate.id !== "string") return null;
    if (!candidate.name || candidate.name.length > 100 || !candidate.id || candidate.id.length > 128) return null;
    return { name: candidate.name, id: candidate.id };
  } catch {
    return null;
  }
}
