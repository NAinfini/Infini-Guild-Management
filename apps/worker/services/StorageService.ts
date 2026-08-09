import {
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  type StorageStockFilter,
  type StorageBatchTransactionResult,
  type SiteStoragePolicy,
  updateStorageItemSchema,
} from "@guild/shared";
import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { storageCategories, storageItems, storages } from "../db/schema";
import type { SessionUser } from "./auth";
import type { WriteAuditLogInput } from "./audit";
import { err, ok, type ServiceResult } from "./result";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import {
  toItemPayload,
  toStoragePayload,
  type StorageImageRow,
  type StorageItemRow,
} from "./StorageServicePayloads";
import { getStorageTransactionPayload, listStorageTransactionPayloads } from "./StorageTransactionQueries";
import { deleteStorageImage, uploadStorageImages } from "./StorageImageService";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { applyStorageBatchTransactions } from "./StorageBatchService";
import { escapeLikePattern, likeEscaped } from "./helpers";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
export type StorageServiceDeps = {
  mediaService: MediaService;
  rawDb: D1Database;
  getStoragePolicy: () => Promise<SiteStoragePolicy>;
  systemTestRunId?: string | null;
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
};

function nowIso(): string {
  return new Date().toISOString();
}

const STORAGE_QUANTITY_CONSTRAINT = "storage_items_quantity_nonnegative";

function isStorageQuantityConstraintViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STORAGE_QUANTITY_CONSTRAINT);
}

function isForeignKeyConstraintViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("FOREIGN KEY constraint failed");
}

function getBatchChanges(result: { meta?: { changes?: number } } | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function getCommittedDelta(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || !("quantity_delta" in payload)) return null;
  const value = (payload as { quantity_delta?: unknown }).quantity_delta;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

type StorageItemCursor = { name: string; id: string };
const STORAGE_CURSOR_MAX_LENGTH = 512;

function decodeStorageItemCursor(value: string): StorageItemCursor | null {
  if (value.length === 0 || value.length > STORAGE_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).length !== 2 || typeof cursor.name !== "string" || typeof cursor.id !== "string") return null;
    if (cursor.name.length === 0 || cursor.name.length > 100 || cursor.id.length === 0 || cursor.id.length > 128) return null;
    return { name: cursor.name, id: cursor.id };
  } catch {
    return null;
  }
}

function encodeStorageItemCursor(cursor: StorageItemCursor): string {
  const json = JSON.stringify(cursor);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class StorageService {
  constructor(
    private db: DrizzleDb,
    private deps: StorageServiceDeps,
  ) {}

  private isManager(sessionUser: SessionUser): boolean {
    return sessionUser.permissions.has("admin.storage.stock");
  }

  private async getItemRow(itemId: string): Promise<StorageItemRow | null> {
    return (await this.db.select().from(storageItems).where(eq(storageItems.id, itemId)).limit(1))[0] ?? null;
  }

  private async getImages(itemId: string): Promise<StorageImageRow[]> {
    return (await this.deps.mediaService.listLinkedMediaIds("storage_item", itemId, "image"))
      .map((mediaId) => ({ mediaId }));
  }

  private async validateItemCategory(
    storageId: string,
    categoryId: string | null,
  ): Promise<ServiceResult<never> | null> {
    const storage = (await this.db.select({ id: storages.id })
      .from(storages)
      .where(eq(storages.id, storageId))
      .limit(1))[0];
    if (!storage) return err("NOT_FOUND", "Storage not found");
    if (categoryId === null) return null;

    const category = (await this.db.select({ storageId: storageCategories.storageId })
      .from(storageCategories)
      .where(eq(storageCategories.id, categoryId))
      .limit(1))[0];
    if (!category) return err("NOT_FOUND", "Category not found");
    if (category.storageId !== storageId) {
      return err("VALIDATION_ERROR", "Category does not belong to storage");
    }
    return null;
  }

  async getTree(): Promise<ServiceResult<{ data: unknown[] }>> {
    const [storageRows, categoryRows] = await Promise.all([
      this.db.select().from(storages).orderBy(asc(storages.name), asc(storages.id)),
      this.db.select().from(storageCategories).orderBy(asc(storageCategories.name), asc(storageCategories.id)),
    ]);
    return ok({
      data: storageRows.map((storage) => toStoragePayload(
        storage,
        categoryRows.filter((category) => category.storageId === storage.id),
      )),
    });
  }

  async createStorage(actorId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid storage payload", parsed.error.flatten());
    const id = nanoid();
    await this.db.insert(storages).values({ id, name: parsed.data.name, description: parsed.data.description ?? null });
    const created = (await this.db.select().from(storages).where(eq(storages.id, id)).limit(1))[0];
    if (!created) return err("SERVER_ERROR", "Failed to create storage");
    await this.deps.writeAuditLog({ entityType: "storage", action: "create", actorId, entityId: id, diffTitle: created.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: id, hint: "storage_updated" });
    return ok(toStoragePayload(created, []));
  }

  async updateStorage(actorId: string, storageId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageSchema.partial().safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid storage payload", parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) return err("VALIDATION_ERROR", "No fields to update");
    await this.db.update(storages).set({ ...parsed.data }).where(eq(storages.id, storageId));
    const updated = (await this.db.select().from(storages).where(eq(storages.id, storageId)).limit(1))[0];
    if (!updated) return err("NOT_FOUND", "Storage not found");
    const categories = await this.db.select().from(storageCategories).where(eq(storageCategories.storageId, storageId)).orderBy(storageCategories.name);
    await this.deps.writeAuditLog({ entityType: "storage", action: "update", actorId, entityId: storageId, diffTitle: updated.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: storageId, hint: "storage_updated" });
    return ok(toStoragePayload(updated, categories));
  }

  async deleteStorage(actorId: string, storageId: string): Promise<ServiceResult<{ ok: true }>> {
    const countRow = (await this.db.select({ count: sql<number>`count(*)` }).from(storageItems).where(eq(storageItems.storageId, storageId)))[0];
    if (Number(countRow?.count ?? 0) > 0) return err("VALIDATION_ERROR", "Storage must be empty before deletion");
    await this.db.delete(storages).where(eq(storages.id, storageId));
    await this.deps.writeAuditLog({ entityType: "storage", action: "delete", actorId, entityId: storageId });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: storageId, hint: "storage_updated" });
    return ok({ ok: true });
  }

  async createCategory(actorId: string, storageId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageCategorySchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid category payload", parsed.error.flatten());
    const id = nanoid();
    await this.db.insert(storageCategories).values({ id, storageId, name: parsed.data.name });
    await this.deps.writeAuditLog({ entityType: "storage_category", action: "create", actorId, entityId: id, diffTitle: parsed.data.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: storageId, hint: "storage_updated" });
    return ok({ id, name: parsed.data.name });
  }

  async updateCategory(actorId: string, storageId: string, categoryId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageCategorySchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid category payload", parsed.error.flatten());
    await this.db.update(storageCategories).set({ name: parsed.data.name }).where(and(eq(storageCategories.id, categoryId), eq(storageCategories.storageId, storageId)));
    await this.deps.writeAuditLog({ entityType: "storage_category", action: "update", actorId, entityId: categoryId, diffTitle: parsed.data.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: storageId, hint: "storage_updated" });
    return ok({ id: categoryId, name: parsed.data.name });
  }

  async deleteCategory(actorId: string, storageId: string, categoryId: string): Promise<ServiceResult<{ ok: true }>> {
    const countRow = (await this.db.select({ count: sql<number>`count(*)` }).from(storageItems).where(eq(storageItems.categoryId, categoryId)))[0];
    if (Number(countRow?.count ?? 0) > 0) return err("VALIDATION_ERROR", "Category must be empty before deletion");
    await this.db.delete(storageCategories).where(and(eq(storageCategories.id, categoryId), eq(storageCategories.storageId, storageId)));
    await this.deps.writeAuditLog({ entityType: "storage_category", action: "delete", actorId, entityId: categoryId });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: storageId, hint: "storage_updated" });
    return ok({ ok: true });
  }

  async listItems(options: {
    storageId?: string;
    categoryId?: string | null;
    search?: string;
    stock: StorageStockFilter;
    limit: number;
    cursor?: string;
  }): Promise<ServiceResult<{ data: unknown[]; next_cursor: string | null }>> {
    const cursor = options.cursor ? decodeStorageItemCursor(options.cursor) : undefined;
    if (options.cursor && !cursor) return err("VALIDATION_ERROR", "Invalid storage item cursor");
    const filters: SQL<unknown>[] = [];
    if (options.storageId) filters.push(eq(storageItems.storageId, options.storageId));
    if (options.categoryId) filters.push(eq(storageItems.categoryId, options.categoryId));
    const search = options.search?.trim().toLowerCase();
    if (search) filters.push(likeEscaped(sql`lower(${storageItems.name})`, `%${escapeLikePattern(search)}%`));
    if (options.stock === "available") filters.push(gt(storageItems.quantity, 0));
    if (options.stock === "empty") filters.push(eq(storageItems.quantity, 0));
    if (options.stock === "deposit") filters.push(eq(storageItems.allowMemberDeposit, true));
    if (options.stock === "withdraw") filters.push(eq(storageItems.allowMemberWithdraw, true));
    if (cursor) filters.push(or(gt(storageItems.name, cursor.name), and(eq(storageItems.name, cursor.name), gt(storageItems.id, cursor.id)))!);
    const itemRows = await this.db.select().from(storageItems).where(and(...filters)).orderBy(asc(storageItems.name), asc(storageItems.id)).limit(options.limit + 1);
    const hasMore = itemRows.length > options.limit;
    const pageRows = hasMore ? itemRows.slice(0, options.limit) : itemRows;
    const ids = pageRows.map((item) => item.id);
    const linkedMedia = await this.deps.mediaService.listLinkedMedia("storage_item", ids, ["image"]);
    const lastItem = pageRows.at(-1);
    return ok({
      data: pageRows.map((item) => toItemPayload(item, (linkedMedia.get(item.id) ?? []).map((image) => ({ mediaId: image.mediaId })))),
      next_cursor: hasMore && lastItem ? encodeStorageItemCursor({ name: lastItem.name, id: lastItem.id }) : null,
    });
  }

  async getItem(itemId: string): Promise<ServiceResult<unknown>> {
    const item = await this.getItemRow(itemId);
    if (!item) return err("NOT_FOUND", "Item not found");
    return ok(toItemPayload(item, await this.getImages(itemId)));
  }

  async createItem(actorId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageItemSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid item payload", parsed.error.flatten());
    const categoryId = parsed.data.category_id ?? null;
    const categoryError = await this.validateItemCategory(parsed.data.storage_id, categoryId);
    if (categoryError) return categoryError;
    const id = nanoid();
    try {
      await this.db.insert(storageItems).values({
        id,
        storageId: parsed.data.storage_id,
        categoryId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        allowMemberDeposit: parsed.data.allow_member_deposit,
        allowMemberWithdraw: parsed.data.allow_member_withdraw,
      });
    } catch (error) {
      if (!isForeignKeyConstraintViolation(error)) throw error;
      const currentError = await this.validateItemCategory(parsed.data.storage_id, categoryId);
      return currentError ?? err("CONFLICT", "Storage or category changed; refresh and retry");
    }
    const created = await this.getItemRow(id);
    if (!created) return err("SERVER_ERROR", "Failed to create item");
    await this.deps.writeAuditLog({ entityType: "storage_item", action: "create", actorId, entityId: id, diffTitle: created.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: id, hint: "storage_updated" });
    return ok(toItemPayload(created));
  }

  async updateItem(actorId: string, itemId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = updateStorageItemSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid item payload", parsed.error.flatten());
    if (Object.keys(parsed.data).length === 0) return err("VALIDATION_ERROR", "No fields to update");
    const existing = await this.getItemRow(itemId);
    if (!existing) return err("NOT_FOUND", "Item not found");
    if (parsed.data.category_id !== undefined) {
      const categoryError = await this.validateItemCategory(existing.storageId, parsed.data.category_id);
      if (categoryError) return categoryError;
    }
    try {
      await this.db.update(storageItems).set({
        ...(parsed.data.category_id !== undefined ? { categoryId: parsed.data.category_id } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
        ...(parsed.data.allow_member_deposit !== undefined ? { allowMemberDeposit: parsed.data.allow_member_deposit } : {}),
        ...(parsed.data.allow_member_withdraw !== undefined ? { allowMemberWithdraw: parsed.data.allow_member_withdraw } : {}),
        updatedAt: nowIso(),
      }).where(eq(storageItems.id, itemId));
    } catch (error) {
      if (!isForeignKeyConstraintViolation(error)) throw error;
      const currentError = parsed.data.category_id === undefined
        ? null
        : await this.validateItemCategory(existing.storageId, parsed.data.category_id);
      return currentError ?? err("CONFLICT", "Storage or category changed; refresh and retry");
    }
    const updated = await this.getItemRow(itemId);
    if (!updated) return err("NOT_FOUND", "Item not found");
    await this.deps.writeAuditLog({ entityType: "storage_item", action: "update", actorId, entityId: itemId, diffTitle: updated.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    return ok(toItemPayload(updated, await this.getImages(itemId)));
  }

  async deleteItem(actorId: string, itemId: string): Promise<ServiceResult<{ ok: true }>> {
    const item = await this.getItemRow(itemId);
    if (!item) return err("NOT_FOUND", "Item not found");
    const ledgerEntry = await this.deps.rawDb
      .prepare("SELECT 1 AS present FROM storage_transactions WHERE item_id = ?1 LIMIT 1")
      .bind(itemId)
      .first<{ present: number }>();
    if (ledgerEntry) return err("CONFLICT", "Storage items with transaction history cannot be deleted");
    try {
      await this.deps.rawDb.prepare("DELETE FROM storage_items WHERE id = ?1").bind(itemId).run();
    } catch (error) {
      if (isForeignKeyConstraintViolation(error)) {
        return err("CONFLICT", "Storage items with transaction history cannot be deleted");
      }
      throw error;
    }
    await this.deps.writeAuditLog({
      entityType: "storage_item",
      action: "delete",
      actorId,
      entityId: itemId,
      diffTitle: item.name,
      detail: { final_quantity: item.quantity },
    });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    return ok({ ok: true });
  }

  async applyTransaction(sessionUser: SessionUser, itemId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageTransactionSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid transaction payload", parsed.error.flatten());
    const item = await this.getItemRow(itemId);
    if (!item) return err("NOT_FOUND", "Item not found");
    const recipientUserId = this.isManager(sessionUser) ? parsed.data.recipient_user_id ?? null : sessionUser.id;
    if (!this.isManager(sessionUser)) {
      const memberAllowed =
        (parsed.data.type === "intake" && item.allowMemberDeposit) ||
        (parsed.data.type === "distribute" && item.allowMemberWithdraw);
      if (!memberAllowed) return err("FORBIDDEN", "This item does not allow member self-service for this operation");
    }

    const requestedQuantity = parsed.data.quantity ?? 0;
    const targetQuantity = parsed.data.target_quantity;
    const delta = parsed.data.type === "intake" ? requestedQuantity : -requestedQuantity;
    if (parsed.data.type === "adjust" && targetQuantity === item.quantity) {
      return err("VALIDATION_ERROR", "Target quantity is already current stock");
    }
    if (parsed.data.type === "distribute" && item.quantity + delta < 0) {
      return err("VALIDATION_ERROR", `Insufficient stock (have ${item.quantity})`);
    }

    const txId = nanoid();
    if (parsed.data.type === "adjust") {
      const committedTarget = targetQuantity as number;
      const results = await this.deps.rawDb.batch([
        this.deps.rawDb.prepare(`
          INSERT INTO storage_transactions
            (id, item_id, type, quantity_delta, recipient_user_id, note, actor_id)
          SELECT ?1, id, 'adjust', ?2 - quantity, ?3, ?4, ?5
          FROM storage_items
          WHERE id = ?6 AND quantity <> ?2
        `).bind(
          txId,
          committedTarget,
          recipientUserId,
          parsed.data.note ?? null,
          sessionUser.id,
          itemId,
        ),
        this.deps.rawDb.prepare(`
          UPDATE storage_items
          SET quantity = ?1, updated_at = ?2
          WHERE id = ?3 AND quantity <> ?1
        `).bind(committedTarget, nowIso(), itemId),
      ]);
      const insertedRows = getBatchChanges(results[0]);
      const updatedRows = getBatchChanges(results[1]);
      if (insertedRows === 0 && updatedRows === 0) {
        const currentItem = await this.getItemRow(itemId);
        if (!currentItem) return err("NOT_FOUND", "Item not found");
        if (currentItem.quantity === committedTarget) {
          return err("VALIDATION_ERROR", "Target quantity is already current stock");
        }
        throw new Error("Storage adjustment changed during transaction");
      }
      if (insertedRows !== 1 || updatedRows !== 1) {
        throw new Error("Storage adjustment transaction invariant failed");
      }
    } else {
      try {
        await this.deps.rawDb.batch([
          this.deps.rawDb.prepare("UPDATE storage_items SET quantity = quantity + ?1, updated_at = ?2 WHERE id = ?3").bind(delta, nowIso(), itemId),
          this.deps.rawDb.prepare("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, recipient_user_id, note, actor_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
            .bind(txId, itemId, parsed.data.type, delta, recipientUserId, parsed.data.note ?? null, sessionUser.id),
        ]);
      } catch (error) {
        const isQuantityConflict = isStorageQuantityConstraintViolation(error);
        if (!isQuantityConflict && !isForeignKeyConstraintViolation(error)) throw error;
        const currentItem = await this.getItemRow(itemId);
        if (!currentItem) return err("NOT_FOUND", "Item not found");
        if (isQuantityConflict && parsed.data.type === "distribute" && currentItem.quantity < requestedQuantity) {
          return err("CONFLICT", "Stock changed; refresh and retry", {
            current_quantity: currentItem.quantity,
            requested_quantity: requestedQuantity,
          });
        }
        throw error;
      }
    }

    const tx = await getStorageTransactionPayload(this.deps.rawDb, txId);
    const committedDelta = getCommittedDelta(tx);
    if (parsed.data.type === "adjust" && committedDelta === null) {
      throw new Error("Storage adjustment ledger entry missing after commit");
    }
    const auditDelta = committedDelta ?? delta;
    await this.deps.writeAuditLog({
      entityType: "storage_transaction",
      action: parsed.data.type,
      actorId: sessionUser.id,
      entityId: txId,
      diffTitle: item.name,
      detail: {
        item_id: itemId,
        quantity_delta: auditDelta,
        recipient_user_id: recipientUserId,
        note: parsed.data.note ?? null,
        ...(parsed.data.type === "adjust" ? { target_quantity: targetQuantity } : {}),
      },
    });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    return ok(tx ?? { id: txId, item_id: itemId, type: parsed.data.type, quantity_delta: auditDelta });
  }

  async applyBatchTransactions(sessionUser: SessionUser, body: unknown): Promise<ServiceResult<StorageBatchTransactionResult>> {
    return applyStorageBatchTransactions(this.deps, sessionUser, body);
  }

  async listTransactions(options: { itemId?: string; recipientUserId?: string; page: number; limit: number }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    return ok(await listStorageTransactionPayloads(this.deps.rawDb, options));
  }

  async uploadImages(actorId: string, itemId: string, uploads: readonly ParsedImageMediaUpload[], maxBytes: number): Promise<ServiceResult<unknown[]>> {
    return uploadStorageImages(this.db, this.deps, actorId, itemId, uploads, maxBytes);
  }

  async deleteImage(actorId: string, itemId: string, imageId: string): Promise<ServiceResult<{ ok: true }>> {
    return deleteStorageImage(this.db, this.deps, actorId, itemId, imageId);
  }
}
