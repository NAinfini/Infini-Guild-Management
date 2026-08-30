import type {
  StockCommit,
  StockSubmissionEntry,
  StockSubmissionSnapshot,
  StorageCategoryCreateResult,
  StorageCategoryDeleteResult,
  StorageDeleteResult,
  StorageItemRecord,
  StorageItemMediaMutationResult,
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
  ): Promise<StorageItemMediaMutationResult> {
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
    const guard = itemRevisionGuard(input.itemId, input.expectedUpdatedAt);
    const results = await this.sql.batch([
      ...replaceMediaLinksStatements({
        entityType: "storage_item",
        entityId: input.itemId,
        slot: "image",
        audience: "authenticated",
        mediaIds: desired,
      }, guard),
      auditInsertStatement(input.audit, guard),
      {
        method: "get",
        columns: ["updated_at"],
        sql: `UPDATE storage_items SET updated_at = ?
          WHERE id = ? AND updated_at = ?
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING updated_at`,
        params: [input.updatedAt, input.itemId, input.expectedUpdatedAt, input.audit.eventId],
      },
    ]);
    if (returnedRowCount(results.at(-1)) === 1) {
      return { status: "updated", mediaIds: uploaded, updatedAt: input.updatedAt };
    }
    const state = await itemRevisionState(this.sql, input.itemId, input.expectedUpdatedAt);
    return state === "not_found" ? { status: "not_found" } : { status: "stale" };
  }

  async detachItemImage(
    input: Parameters<StorageMediaPort["detachItemImage"]>[0],
  ): Promise<StorageItemMediaMutationResult> {
    input.context.authorization.requireAuthenticated();
    const guard = {
      sql: `SELECT 1 FROM storage_items
        WHERE id = ? AND updated_at = ?
          AND EXISTS (
            SELECT 1 FROM media_links
            WHERE media_id = ? AND entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'
          )`,
      params: [input.itemId, input.expectedUpdatedAt, input.mediaId, input.itemId],
    };
    const results = await this.sql.batch([
      auditInsertStatement(input.audit, guard),
      {
        method: "get",
        sql: `DELETE FROM media_links
          WHERE media_id = ? AND entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
            AND EXISTS (SELECT 1 FROM storage_items WHERE id = ? AND updated_at = ?)
          RETURNING media_id AS media_id`,
        params: [input.mediaId, input.itemId, input.audit.eventId, input.itemId, input.expectedUpdatedAt],
        columns: ["media_id"],
      },
      {
        method: "get",
        columns: ["updated_at"],
        sql: `UPDATE storage_items SET updated_at = ?
          WHERE id = ? AND updated_at = ?
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING updated_at`,
        params: [input.updatedAt, input.itemId, input.expectedUpdatedAt, input.audit.eventId],
      },
    ]);
    if (returnedRowCount(results[2]) === 1) {
      return { status: "updated", mediaIds: [], updatedAt: input.updatedAt };
    }
    const state = await itemRevisionState(this.sql, input.itemId, input.expectedUpdatedAt);
    if (state === "not_found") return { status: "not_found" };
    if (state === "stale") return { status: "stale" };
    return { status: "image_not_found" };
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
        structure_revision: storage.structureRevision,
        categories: byStorage.get(storage.id) ?? [],
      })),
    };
  }

  async createStorage(input: Readonly<{ storage: Storage; audit: Parameters<typeof auditInsertStatement>[0] }>) {
    const results = await this.sql.batch([{
      method: "all",
      columns: ["storage_id"],
      sql: `INSERT INTO storages (id, name, description, created_at, structure_revision)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM storages) < ?
        RETURNING id AS storage_id`,
      params: [
        input.storage.id,
        input.storage.name,
        input.storage.description,
        input.storage.created_at,
        input.storage.structure_revision,
        LIMITS.content.storageStructure.storages.max,
      ],
    }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
    return returnedRowCount(results[0]) === 1 ? "created" as const : "limit_reached" as const;
  }

  async updateStorage(input: Parameters<StorageStore["updateStorage"]>[0]): ReturnType<StorageStore["updateStorage"]> {
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
      params.push(
        input.id,
        input.expected.name,
        input.expected.description,
        input.expected.structureRevision,
        ...differenceParams,
      );
      const results = await this.sql.batch([{
        method: "all",
        columns: ["storage_id"],
        sql: `UPDATE storages SET ${assignments.join(", ")}, structure_revision = structure_revision + 1
          WHERE id = ? AND name IS ? AND description IS ? AND structure_revision = ?
            AND (${differences.join(" OR ")})
          RETURNING id AS storage_id`,
        params,
      }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
      if (returnedRowCount(results[0]) === 0) {
        const current = (await this.db.select().from(storages).where(eq(storages.id, input.id)).limit(1))[0];
        if (!current) return { status: "not_found" };
        if (current.name !== input.expected.name
          || current.description !== input.expected.description
          || current.structureRevision !== input.expected.structureRevision) {
          return { status: "stale" };
        }
      }
    }
    const categories = await this.db.select().from(storageCategories)
      .where(eq(storageCategories.storageId, input.id))
      .orderBy(asc(storageCategories.name), asc(storageCategories.id))
      .limit(LIMITS.content.storageStructure.categories.max + 1);
    if (categories.length > LIMITS.content.storageStructure.categories.max) {
      throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Storage category data invariant violated" });
    }
    const row = (await this.db.select().from(storages).where(eq(storages.id, input.id)).limit(1))[0];
    if (!row) return { status: "not_found" };
    return { status: "updated", value: {
      id: row.id,
      name: row.name,
      description: row.description,
      created_at: row.createdAt,
      structure_revision: row.structureRevision,
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
    } };
  }

  async deleteStorage(input: Parameters<StorageStore["deleteStorage"]>[0]): Promise<StorageDeleteResult> {
    const exists = (await this.db.select({ id: storages.id, structureRevision: storages.structureRevision })
      .from(storages).where(eq(storages.id, input.id)).limit(1))[0];
    if (!exists) return "not_found";
    if (exists.structureRevision !== input.expectedStructureRevision) return "stale";
    const item = (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.storageId, input.id)).limit(1))[0];
    if (item) return "not_empty";
    const results = await this.sql.batch([auditInsertStatement(input.audit, {
      sql: `SELECT 1 FROM storages
        WHERE id = ? AND structure_revision = ?
          AND NOT EXISTS (SELECT 1 FROM storage_items WHERE storage_id = ?)`,
      params: [input.id, input.expectedStructureRevision, input.id],
    }), {
      method: "get",
      sql: `DELETE FROM storages
        WHERE id = ? AND structure_revision = ?
          AND NOT EXISTS (SELECT 1 FROM storage_items WHERE storage_id = ?)
          AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
        RETURNING id AS storage_id`,
      params: [input.id, input.expectedStructureRevision, input.id, input.audit.eventId],
      columns: ["storage_id"],
    }]);
    if (returnedRowCount(results[1]) === 1) return "deleted";
    const current = (await this.db.select({ id: storages.id, structureRevision: storages.structureRevision })
      .from(storages).where(eq(storages.id, input.id)).limit(1))[0];
    if (!current) return "not_found";
    if (current.structureRevision !== input.expectedStructureRevision) return "stale";
    return (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.storageId, input.id)).limit(1))[0] ? "not_empty" : "stale";
  }

  async createCategory(input: Parameters<StorageStore["createCategory"]>[0]): Promise<StorageCategoryCreateResult> {
    const storage = (await this.db.select({ id: storages.id, structureRevision: storages.structureRevision }).from(storages)
      .where(eq(storages.id, input.storageId)).limit(1))[0];
    if (!storage) return { status: "storage_missing" };
    if (storage.structureRevision !== input.expectedStructureRevision) return { status: "stale" };
    try {
      const results = await this.sql.batch([{
        method: "all",
        columns: ["category_id"],
        sql: `INSERT INTO storage_categories (id, storage_id, name, created_at)
          SELECT ?, ?, ?, ?
          WHERE (SELECT count(*) FROM storage_categories) < ?
            AND EXISTS (
              SELECT 1 FROM storages WHERE id = ? AND structure_revision = ?
            )
          RETURNING id AS category_id`,
        params: [
          input.category.id,
          input.storageId,
          input.category.name,
          input.createdAt,
          LIMITS.content.storageStructure.categories.max,
          input.storageId,
          input.expectedStructureRevision,
        ],
      }, {
        method: "get",
        columns: ["structure_revision"],
        sql: `UPDATE storages SET structure_revision = structure_revision + 1
          WHERE id = ? AND structure_revision = ?
            AND changes() = 1
            AND EXISTS (SELECT 1 FROM storage_categories WHERE id = ? AND storage_id = ?)
          RETURNING structure_revision`,
        params: [
          input.storageId,
          input.expectedStructureRevision,
          input.category.id,
          input.storageId,
        ],
      }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
      if (returnedRowCount(results[1]) === 1) {
        return {
          status: "created",
          value: input.category,
          structureRevision: numberValue(getRow(results[1])?.[0]),
        };
      }
      const current = (await this.db.select({ structureRevision: storages.structureRevision }).from(storages)
        .where(eq(storages.id, input.storageId)).limit(1))[0];
      if (!current) return { status: "storage_missing" };
      if (current.structureRevision !== input.expectedStructureRevision) return { status: "stale" };
      return { status: "limit_reached" };
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async updateCategory(input: Parameters<StorageStore["updateCategory"]>[0]): ReturnType<StorageStore["updateCategory"]> {
    const results = await this.sql.batch([{
      method: "get",
      sql: `UPDATE storage_categories SET name = ?
        WHERE id = ? AND storage_id = ? AND name IS ? AND name IS NOT ?
          AND EXISTS (
            SELECT 1 FROM storages WHERE id = ? AND structure_revision = ?
          )
        RETURNING id AS category_id`,
      params: [
        input.name,
        input.categoryId,
        input.storageId,
        input.expectedName,
        input.name,
        input.storageId,
        input.expectedStructureRevision,
      ],
      columns: ["category_id"],
    }, {
      method: "get",
      columns: ["structure_revision"],
      sql: `UPDATE storages SET structure_revision = structure_revision + 1
        WHERE id = ? AND structure_revision = ?
          AND changes() = 1
          AND EXISTS (
            SELECT 1 FROM storage_categories
            WHERE id = ? AND storage_id = ? AND name = ?
          )
        RETURNING structure_revision`,
      params: [
        input.storageId,
        input.expectedStructureRevision,
        input.categoryId,
        input.storageId,
        input.name,
      ],
    }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" })]);
    if (returnedRowCount(results[1]) === 1) {
      return {
        status: "updated",
        value: {
          category: { id: input.categoryId, name: input.name },
          structureRevision: numberValue(getRow(results[1])?.[0]),
        },
      };
    }
    const [currentStorage, currentCategory] = await Promise.all([
      this.db.select({ id: storages.id, structureRevision: storages.structureRevision }).from(storages)
        .where(eq(storages.id, input.storageId)).limit(1),
      this.db.select({ id: storageCategories.id, name: storageCategories.name })
        .from(storageCategories).where(and(
          eq(storageCategories.id, input.categoryId),
          eq(storageCategories.storageId, input.storageId),
        )).limit(1),
    ]);
    if (!currentStorage[0] || !currentCategory[0]) return { status: "not_found" };
    if (currentStorage[0].structureRevision !== input.expectedStructureRevision
      || currentCategory[0].name !== input.expectedName) return { status: "stale" };
    if (input.name === input.expectedName) {
      return {
        status: "updated",
        value: {
          category: currentCategory[0],
          structureRevision: currentStorage[0].structureRevision,
        },
      };
    }
    return { status: "stale" };
  }

  async deleteCategory(
    input: Parameters<StorageStore["deleteCategory"]>[0],
  ): Promise<StorageCategoryDeleteResult> {
    const storage = (await this.db.select({ id: storages.id, structureRevision: storages.structureRevision }).from(storages)
      .where(eq(storages.id, input.storageId)).limit(1))[0];
    if (!storage) return { status: "not_found" };
    if (storage.structureRevision !== input.expectedStructureRevision) return { status: "stale" };
    const category = (await this.db.select({ id: storageCategories.id }).from(storageCategories).where(and(
      eq(storageCategories.id, input.categoryId),
      eq(storageCategories.storageId, input.storageId),
    )).limit(1))[0];
    if (!category) return { status: "not_found" };
    const item = (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.categoryId, input.categoryId)).limit(1))[0];
    if (item) return { status: "not_empty" };
    const results = await this.sql.batch([{
      method: "get",
      columns: ["structure_revision"],
      sql: `UPDATE storages SET structure_revision = structure_revision + 1
        WHERE id = ? AND structure_revision = ?
          AND EXISTS (
            SELECT 1 FROM storage_categories
            WHERE id = ? AND storage_id = ?
              AND NOT EXISTS (SELECT 1 FROM storage_items WHERE category_id = ?)
          )
        RETURNING structure_revision`,
      params: [
        input.storageId,
        input.expectedStructureRevision,
        input.categoryId,
        input.storageId,
        input.categoryId,
      ],
    }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }), {
      method: "get",
      sql: `DELETE FROM storage_categories
        WHERE id = ? AND storage_id = ?
          AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
        RETURNING id AS category_id`,
      params: [input.categoryId, input.storageId, input.audit.eventId],
      columns: ["category_id"],
    }]);
    if (returnedRowCount(results[2]) === 1) {
      return { status: "deleted", structureRevision: numberValue(getRow(results[0])?.[0]) };
    }
    const [currentStorage, currentCategory] = await Promise.all([
      this.db.select({ structureRevision: storages.structureRevision }).from(storages)
        .where(eq(storages.id, input.storageId)).limit(1),
      this.db.select({ id: storageCategories.id }).from(storageCategories).where(and(
        eq(storageCategories.id, input.categoryId),
        eq(storageCategories.storageId, input.storageId),
      )).limit(1),
    ]);
    if (!currentStorage[0] || !currentCategory[0]) return { status: "not_found" };
    if (currentStorage[0].structureRevision !== input.expectedStructureRevision) return { status: "stale" };
    return (await this.db.select({ id: storageItems.id }).from(storageItems)
      .where(eq(storageItems.categoryId, input.categoryId)).limit(1))[0]
      ? { status: "not_empty" }
      : { status: "stale" };
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
          item.created_at, item.updated_at, item.rarity, item.unit
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
    const result = await this.sql.execute(storageItemSnapshotStatement(itemId));
    return allRows(result).map(itemFromSqlRow)[0] ?? null;
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
          allow_member_deposit, allow_member_withdraw, created_at, updated_at, rarity, unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.rarity,
          item.unit,
        ],
      }, auditInsertStatement(audit)]);
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async updateItem(input: Parameters<StorageStore["updateItem"]>[0]): ReturnType<StorageStore["updateItem"]> {
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
    if (patch.rarity !== undefined) {
      assignments.push("rarity = ?");
      params.push(patch.rarity);
    }
    if (patch.unit !== undefined) {
      assignments.push("unit = ?");
      params.push(patch.unit);
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
    params.push(input.updatedAt, input.id, input.expectedUpdatedAt);
    try {
      const results = await this.sql.batch([{
        method: "all",
        columns: ["item_id"],
        sql: `UPDATE storage_items SET ${assignments.join(", ")} WHERE id = ? AND updated_at = ?
          RETURNING id AS item_id`,
        params,
      }, auditInsertStatement(input.audit, { sql: "SELECT 1 WHERE changes() = 1" }), storageItemSnapshotStatement(input.id, input.updatedAt)]);
      if (returnedRowCount(results[0]) === 0) {
        const current = await this.getItem(input.id);
        if (!current) return { status: "not_found" };
        if (current.updated_at !== input.expectedUpdatedAt) return { status: "stale" };
        return { status: "updated", value: current };
      }
      const snapshot = allRows(results[2]).map(itemFromSqlRow)[0];
      if (!snapshot) throw new StorageStoreError("constraint");
      return { status: "updated", value: snapshot };
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async deleteItem(input: Parameters<StorageStore["deleteItem"]>[0]): Promise<StorageDeleteResult> {
    const item = await this.getItem(input.itemId);
    if (!item) return "not_found";
    if (item.updated_at !== input.expectedUpdatedAt) return "stale";
    const ledger = (await this.db.select({ id: storageLedgerEntries.id }).from(storageLedgerEntries)
      .where(eq(storageLedgerEntries.itemId, input.itemId)).limit(1))[0];
    if (ledger) return "has_ledger";
    try {
      const results = await this.sql.batch([auditInsertStatement(input.audit, {
        sql: `SELECT 1 FROM storage_items
          WHERE id = ? AND updated_at = ?
            AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)`,
        params: [input.itemId, input.expectedUpdatedAt, input.itemId],
      }), {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'storage_item' AND entity_id = ? AND slot = 'image'
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
            AND EXISTS (
              SELECT 1 FROM storage_items
              WHERE id = ?
                AND updated_at = ?
                AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)
            )`,
        params: [
          input.itemId,
          input.audit.eventId,
          input.itemId,
          input.expectedUpdatedAt,
          input.itemId,
        ],
      }, {
        method: "get",
        sql: `DELETE FROM storage_items
          WHERE id = ? AND updated_at = ?
            AND NOT EXISTS (SELECT 1 FROM storage_ledger_entries WHERE item_id = ?)
            AND EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
          RETURNING id AS item_id`,
        params: [input.itemId, input.expectedUpdatedAt, input.itemId, input.audit.eventId],
        columns: ["item_id"],
      }]);
      if (returnedRowCount(results[2]) === 1) return "deleted";
      const current = await this.getItem(input.itemId);
      if (!current) return "not_found";
      if (current.updated_at !== input.expectedUpdatedAt) return "stale";
      return (await this.db.select({ id: storageLedgerEntries.id }).from(storageLedgerEntries)
        .where(eq(storageLedgerEntries.itemId, input.itemId)).limit(1))[0] ? "has_ledger" : "stale";
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
          actor.display_name AS actor_display_name,
          recipient.id AS recipient_id,
          recipient.display_name AS recipient_display_name,
          item.rarity AS item_rarity,
          item.unit AS item_unit
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
          batch.request_fingerprint AS request_fingerprint,
          batch.transaction_type AS transaction_type,
          batch.recipient_user_id AS recipient_user_id,
          batch.note AS batch_note,
          ledger.batch_position AS batch_position,
          ledger.id AS ledger_id,
          ledger.item_id AS item_id,
          item.name AS item_name,
          ledger.quantity_delta AS quantity_delta,
          recipient.display_name AS recipient_display_name,
          ledger.actor_id AS actor_id,
          actor.display_name AS actor_display_name,
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
    const transactions = rows.map(transactionFromReplayRow);
    for (const [index, row] of rows.entries()) {
      if (numberValue(row[5]) !== index) throw new StorageStoreError("constraint");
    }
    return {
      id: stringValue(first[0]),
      requestFingerprint: nullableString(first[1]),
      transactions,
    };
  }

  async commitStock(commit: StockCommit): Promise<readonly StorageTransaction[]> {
    const statements: SqlBatchStatement[] = [{
      method: "run",
      sql: `INSERT INTO storage_batches (
        id, actor_id, idempotency_key, request_fingerprint, access_mode, transaction_type,
        recipient_user_id, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        commit.batchId,
        commit.actorId,
        commit.idempotencyKey,
        commit.requestFingerprint,
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
            commit.request.targetQuantity,
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
       recipient.display_name AS recipient_display_name,
       ledger.note AS note,
       ledger.actor_id AS actor_id,
       actor.display_name AS actor_display_name,
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
        "recipient_display_name",
        "note",
        "actor_id",
        "actor_display_name",
        "created_at",
      ];
  if (query.canViewAll) {
    const filters: string[] = [];
    const params: SqlValue[] = [];
    if (query.itemId) {
      filters.push("ledger.item_id = ?");
      params.push(query.itemId);
    }
    if (query.storageId) {
      filters.push("EXISTS (SELECT 1 FROM storage_items AS filter_item WHERE filter_item.id = ledger.item_id AND filter_item.storage_id = ?)");
      params.push(query.storageId);
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
  if (query.storageId) {
    branchFilters.push("EXISTS (SELECT 1 FROM storage_items AS filter_item WHERE filter_item.id = ledger.item_id AND filter_item.storage_id = ?)");
    branchValues.push(query.storageId);
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
    rarity: stringValue(row[10]) as StorageItemRecord["rarity"],
    unit: nullableString(row[11]),
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
      rarity: stringValue(row[17]) as StorageItemRecord["rarity"],
      unit: nullableString(row[18]),
    },
  };
}

function transactionFromReplayRow(row: SqlRow): StorageTransaction {
  return {
    id: stringValue(row[6]),
    item_id: stringValue(row[7]),
    item_name: nullableString(row[8]),
    type: stockType(row[2]),
    quantity_delta: numberValue(row[9]),
    recipient_user_id: nullableString(row[3]),
    recipient_display_name: nullableString(row[10]),
    note: nullableString(row[4]),
    actor_id: stringValue(row[11]),
    actor_display_name: nullableString(row[12]),
    created_at: stringValue(row[13]),
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
    recipient_display_name: nullableString(row[6]),
    note: nullableString(row[7]),
    actor_id: stringValue(row[8]),
    actor_display_name: nullableString(row[9]),
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

function itemRevisionGuard(itemId: string, expectedUpdatedAt: string): Readonly<{
  sql: string;
  params: readonly SqlValue[];
}> {
  return {
    sql: "SELECT 1 FROM storage_items WHERE id = ? AND updated_at = ?",
    params: [itemId, expectedUpdatedAt],
  };
}

function storageItemSnapshotStatement(itemId: string, updatedAt?: string): SqlBatchStatement {
  const revisionGuard = updatedAt === undefined ? "" : " AND item.updated_at = ?";
  return {
    method: "all",
    columns: [
      "id",
      "storage_id",
      "category_id",
      "name",
      "description",
      "quantity",
      "allow_member_deposit",
      "allow_member_withdraw",
      "created_at",
      "updated_at",
      "rarity",
      "unit",
    ],
    sql: `SELECT
        item.id, item.storage_id, item.category_id, item.name, item.description,
        balance.quantity, item.allow_member_deposit, item.allow_member_withdraw,
        item.created_at, item.updated_at, item.rarity, item.unit
      FROM storage_items AS item
      JOIN storage_balances AS balance ON balance.item_id = item.id
      WHERE item.id = ?${revisionGuard}`,
    params: [itemId, ...(updatedAt === undefined ? [] : [updatedAt])],
  };
}

type ItemRevisionState = "not_found" | "stale" | "current";

async function itemRevisionState(
  sql: SqlExecutor,
  itemId: string,
  expectedUpdatedAt: string,
): Promise<ItemRevisionState> {
  const result = await sql.execute({
    method: "get",
    columns: ["updated_at"],
    sql: "SELECT updated_at FROM storage_items WHERE id = ?",
    params: [itemId],
  });
  const row = getRow(result);
  if (!row) return "not_found";
  return stringValue(row[0]) === expectedUpdatedAt ? "current" : "stale";
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
