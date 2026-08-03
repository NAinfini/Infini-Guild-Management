import { DEFAULT_SITE_STORAGE_POLICY, type SiteStoragePolicy } from "@guild/shared";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { storageItemImages, storageItems } from "../db/schema";
import type { WriteAuditLogInput } from "./audit";
import { buildReplaceMediaRefsStatements } from "./media-references";
import { rethrowAfterUploadFailure } from "./media-upload-compensation";
import { err, ok, type ServiceResult } from "./result";
import type { StorageImageRow, StorageItemRow } from "./StorageServicePayloads";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { buildStorageItemImageKey } from "./media-keys";

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
  const attempted: Array<{ imageId: string; key: string }> = [];
  try {
    for (const file of files) {
      const imageId = nanoid();
      const key = buildStorageItemImageKey(itemId, file.contentType, imageId);
      attempted.push({ imageId, key });
      await deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      inserted.push({ id: imageId, itemId, r2Key: key, createdAt: nowIso() });
    }
    const allKeys = [...existing.map((image) => image.r2Key), ...inserted.map((image) => image.r2Key)];
    await deps.rawDb.batch([
      ...inserted.map((image) => deps.rawDb
        .prepare("INSERT INTO storage_item_images (id, item_id, r2_key, created_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(image.id, image.itemId, image.r2Key, image.createdAt)),
      ...buildReplaceMediaRefsStatements(deps.rawDb, "storage_item", itemId, allKeys),
    ]);
    await deps.writeAuditLog({ entityType: "storage_item", action: "upload_images", actorId, entityId: itemId, diffTitle: item.name, detailText: JSON.stringify({ count: files.length }) });
    await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
  } catch (error) {
    await rethrowAfterUploadFailure(
      error,
      (key) => deps.media.delete(key),
      attempted.map((image) => image.key),
    );
  }
  return ok(inserted.map((image) => ({ id: image.id, r2_key: image.r2Key })));
}

export async function deleteStorageImage(db: DrizzleDb, deps: StorageImageDeps, actorId: string, itemId: string, imageId: string): Promise<ServiceResult<{ ok: true }>> {
  const item = await getItemRow(db, itemId);
  if (!item) return err("NOT_FOUND", "Item not found");
  const existing = await getImages(db, itemId);
  if (!existing.some((image) => image.id === imageId)) return err("NOT_FOUND", "Image not found");
  const image = existing.find((candidate) => candidate.id === imageId)!;
  await deps.rawDb.batch([
    deps.rawDb.prepare("DELETE FROM storage_item_images WHERE id = ?1 AND item_id = ?2").bind(imageId, itemId),
    ...buildReplaceMediaRefsStatements(
      deps.rawDb,
      "storage_item",
      itemId,
      existing.filter((candidate) => candidate.id !== imageId).map((candidate) => candidate.r2Key),
    ),
  ]);
  await Promise.allSettled([deps.media.delete(image.r2Key)]);
  const audit: WriteAuditLogInput = { entityType: "storage_item", action: "delete_images", actorId, entityId: itemId, diffTitle: item.name, detailText: JSON.stringify({ image_id: imageId }) };
  await deps.writeAuditLog(audit);
  await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
  return ok({ ok: true });
}
