import {
  createStorageCategorySchema,
  createStorageItemSchema,
  createStorageSchema,
  createStorageTransactionSchema,
  updateStorageItemSchema,
} from "@guild/shared";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { storageCategories, storageItemImages, storageItems, storages } from "../db/schema";
import type { SessionUser } from "./auth";
import type { WriteAuditLogInput } from "./audit";
import { deleteMediaRefs } from "./media-references";
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

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
export type StorageServiceDeps = {
  media: R2Bucket;
  rawDb: D1Database;
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class StorageService {
  constructor(
    private db: DrizzleDb,
    private deps: StorageServiceDeps,
  ) {}

  private isManager(sessionUser: SessionUser): boolean {
    return sessionUser.permissions.has("admin.storage.stock") || sessionUser.permissions.has("admin.storage.manage");
  }

  private async getItemRow(itemId: string): Promise<StorageItemRow | null> {
    return (await this.db.select().from(storageItems).where(eq(storageItems.id, itemId)).limit(1))[0] ?? null;
  }

  private async getImages(itemId: string): Promise<StorageImageRow[]> {
    return this.db.select().from(storageItemImages).where(eq(storageItemImages.itemId, itemId)).orderBy(storageItemImages.createdAt, storageItemImages.id);
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

  async listItems(options: { storageId?: string; categoryId?: string | null; search?: string }): Promise<ServiceResult<{ data: unknown[] }>> {
    const filters: SQL<unknown>[] = [];
    if (options.storageId) filters.push(eq(storageItems.storageId, options.storageId));
    if (options.categoryId) filters.push(eq(storageItems.categoryId, options.categoryId));
    if (options.search) filters.push(sql`lower(${storageItems.name}) LIKE ${`%${options.search.toLowerCase()}%`}`);
    const itemRows = await this.db.select().from(storageItems).where(and(...filters)).orderBy(asc(storageItems.name), asc(storageItems.id));
    const ids = itemRows.map((item) => item.id);
    const imageRows = ids.length > 0
      ? await this.db.select().from(storageItemImages).where(inArray(storageItemImages.itemId, ids)).orderBy(storageItemImages.createdAt, storageItemImages.id)
      : [];
    return ok({ data: itemRows.map((item) => toItemPayload(item, imageRows.filter((image) => image.itemId === item.id))) });
  }

  async getItem(itemId: string): Promise<ServiceResult<unknown>> {
    const item = await this.getItemRow(itemId);
    if (!item) return err("NOT_FOUND", "Item not found");
    return ok(toItemPayload(item, await this.getImages(itemId)));
  }

  async createItem(actorId: string, body: unknown): Promise<ServiceResult<unknown>> {
    const parsed = createStorageItemSchema.safeParse(body);
    if (!parsed.success) return err("VALIDATION_ERROR", "Invalid item payload", parsed.error.flatten());
    const id = nanoid();
    await this.db.insert(storageItems).values({
      id,
      storageId: parsed.data.storage_id,
      categoryId: parsed.data.category_id ?? null,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      allowMemberDeposit: parsed.data.allow_member_deposit,
      allowMemberWithdraw: parsed.data.allow_member_withdraw,
    });
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
    await this.db.update(storageItems).set({
      ...(parsed.data.category_id !== undefined ? { categoryId: parsed.data.category_id } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
      ...(parsed.data.allow_member_deposit !== undefined ? { allowMemberDeposit: parsed.data.allow_member_deposit } : {}),
      ...(parsed.data.allow_member_withdraw !== undefined ? { allowMemberWithdraw: parsed.data.allow_member_withdraw } : {}),
      updatedAt: nowIso(),
    }).where(eq(storageItems.id, itemId));
    const updated = await this.getItemRow(itemId);
    if (!updated) return err("NOT_FOUND", "Item not found");
    await this.deps.writeAuditLog({ entityType: "storage_item", action: "update", actorId, entityId: itemId, diffTitle: updated.name });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    return ok(toItemPayload(updated, await this.getImages(itemId)));
  }

  async deleteItem(actorId: string, itemId: string): Promise<ServiceResult<{ ok: true }>> {
    const item = await this.getItemRow(itemId);
    if (!item) return err("NOT_FOUND", "Item not found");
    await this.db.delete(storageItems).where(eq(storageItems.id, itemId));
    await deleteMediaRefs(this.deps.rawDb, "storage_item", itemId);
    await this.deps.writeAuditLog({
      entityType: "storage_item",
      action: "delete",
      actorId,
      entityId: itemId,
      diffTitle: item.name,
      detailText: JSON.stringify({ final_quantity: item.quantity }),
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
    const delta =
      parsed.data.type === "adjust"
        ? (parsed.data.target_quantity ?? item.quantity) - item.quantity
        : (parsed.data.type === "intake" ? 1 : -1) * (parsed.data.quantity ?? 0);
    if (parsed.data.type === "adjust" && delta === 0) return err("VALIDATION_ERROR", "Target quantity is already current stock");
    if (item.quantity + delta < 0) return err("VALIDATION_ERROR", `Insufficient stock (have ${item.quantity})`);
    const txId = nanoid();
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("UPDATE storage_items SET quantity = quantity + ?1, updated_at = ?2 WHERE id = ?3").bind(delta, nowIso(), itemId),
      this.deps.rawDb.prepare("INSERT INTO storage_transactions (id, item_id, type, quantity_delta, recipient_user_id, note, actor_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(txId, itemId, parsed.data.type, delta, recipientUserId, parsed.data.note ?? null, sessionUser.id),
    ]);
    await this.deps.writeAuditLog({
      entityType: "storage_transaction",
      action: parsed.data.type,
      actorId: sessionUser.id,
      entityId: txId,
      diffTitle: item.name,
      detailText: JSON.stringify({
        item_id: itemId,
        quantity_delta: delta,
        recipient_user_id: recipientUserId,
        note: parsed.data.note ?? null,
        stock_before: item.quantity,
        stock_after: item.quantity + delta,
      }),
    });
    await this.deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    const tx = await getStorageTransactionPayload(this.deps.rawDb, txId);
    return ok(tx ?? { id: txId, item_id: itemId, type: parsed.data.type, quantity_delta: delta });
  }

  async listTransactions(options: { itemId?: string; recipientUserId?: string; page: number; limit: number }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    return ok(await listStorageTransactionPayloads(this.deps.rawDb, options));
  }

  async uploadImages(actorId: string, itemId: string, files: Array<{ data: ArrayBuffer; contentType: string; name: string }>): Promise<ServiceResult<unknown[]>> {
    return uploadStorageImages(this.db, this.deps, actorId, itemId, files);
  }

  async deleteImage(actorId: string, itemId: string, imageId: string): Promise<ServiceResult<{ ok: true }>> {
    return deleteStorageImage(this.db, this.deps, actorId, itemId, imageId);
  }
}
