import { DEFAULT_SITE_STORAGE_POLICY, type SiteStoragePolicy } from "@guild/shared";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { storageItemImages, storageItems } from "../db/schema";
import type { WriteAuditLogInput } from "./audit";
import { replaceMediaRefs } from "./media-references";
import { err, ok, type ServiceResult } from "./result";
import type { StorageImageRow, StorageItemRow } from "./StorageServicePayloads";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
type StorageImageDeps = {
  media: R2Bucket;
  rawDb: D1Database;
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  getStoragePolicy?: () => Promise<SiteStoragePolicy>;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function getItemRow(db: DrizzleDb, itemId: string): Promise<StorageItemRow | null> {
  return (await db.select().from(storageItems).where(eq(storageItems.id, itemId)).limit(1))[0] ?? null;
}

async function getImages(db: DrizzleDb, itemId: string): Promise<StorageImageRow[]> {
  return db.select().from(storageItemImages).where(eq(storageItemImages.itemId, itemId)).orderBy(storageItemImages.createdAt, storageItemImages.id);
}

export async function uploadStorageImages(db: DrizzleDb, deps: StorageImageDeps, actorId: string, itemId: string, files: Array<{ data: ArrayBuffer; contentType: string; name: string }>): Promise<ServiceResult<unknown[]>> {
  const item = await getItemRow(db, itemId);
  if (!item) return err("NOT_FOUND", "Item not found");
  const existing = await getImages(db, itemId);
  const policy = await (deps.getStoragePolicy?.() ?? Promise.resolve(DEFAULT_SITE_STORAGE_POLICY));
  const maxImages = policy.images_per_item;
  if (existing.length + files.length > maxImages) return err("VALIDATION_ERROR", `Maximum ${maxImages} images per item`);
  const inserted: StorageImageRow[] = [];
  for (const file of files) {
    const imageId = nanoid();
    const key = `storage/items/${itemId}/${imageId}`;
    await deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
    await db.insert(storageItemImages).values({ id: imageId, itemId, r2Key: key });
    inserted.push({ id: imageId, itemId, r2Key: key, createdAt: nowIso() });
  }
  const allKeys = [...existing.map((image) => image.r2Key), ...inserted.map((image) => image.r2Key)];
  await replaceMediaRefs(deps.rawDb, "storage_item", itemId, allKeys);
  await deps.writeAuditLog({ entityType: "storage_item", action: "upload_images", actorId, entityId: itemId, diffTitle: item.name, detailText: JSON.stringify({ count: files.length }) });
  await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
  return ok(inserted.map((image) => ({ id: image.id, r2_key: image.r2Key })));
}

export async function deleteStorageImage(db: DrizzleDb, deps: StorageImageDeps, actorId: string, itemId: string, imageId: string): Promise<ServiceResult<{ ok: true }>> {
  const item = await getItemRow(db, itemId);
  if (!item) return err("NOT_FOUND", "Item not found");
  const existing = await getImages(db, itemId);
  if (!existing.some((image) => image.id === imageId)) return err("NOT_FOUND", "Image not found");
  await db.delete(storageItemImages).where(and(eq(storageItemImages.id, imageId), eq(storageItemImages.itemId, itemId)));
  await replaceMediaRefs(deps.rawDb, "storage_item", itemId, existing.filter((image) => image.id !== imageId).map((image) => image.r2Key));
  const audit: WriteAuditLogInput = { entityType: "storage_item", action: "delete_images", actorId, entityId: itemId, diffTitle: item.name, detailText: JSON.stringify({ image_id: imageId }) };
  await deps.writeAuditLog(audit);
  await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
  return ok({ ok: true });
}
