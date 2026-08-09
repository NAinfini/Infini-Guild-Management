import type { SiteStoragePolicy } from "@guild/shared";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { storageItems } from "../db/schema";
import type { WriteAuditLogInput } from "./audit";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { MediaValidationError } from "./MediaService";
import { err, ok, type ServiceResult } from "./result";
import type { StorageItemRow } from "./StorageServicePayloads";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
export type StorageImageDeps = {
  mediaService: MediaService;
  writeAuditLog: (input: WriteAuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  getStoragePolicy: () => Promise<SiteStoragePolicy>;
};

async function getItemRow(db: DrizzleDb, itemId: string): Promise<StorageItemRow | null> {
  return (await db.select().from(storageItems).where(eq(storageItems.id, itemId)).limit(1))[0] ?? null;
}

export async function uploadStorageImages(
  db: DrizzleDb,
  deps: StorageImageDeps,
  actorId: string,
  itemId: string,
  uploads: readonly ParsedImageMediaUpload[],
  maxBytes: number,
): Promise<ServiceResult<Array<{ media_id: string }>>> {
  const item = await getItemRow(db, itemId);
  if (!item) return err("NOT_FOUND", "Item not found");
  const policy = await deps.getStoragePolicy();
  const now = new Date().toISOString();
  if (!await deps.mediaService.checkQuota({
    purpose: "storage_image",
    ownerUserId: actorId,
    scope: { kind: "entity", entityType: "storage_item", entityId: itemId },
    limit: policy.images_per_item,
    incomingCount: uploads.length,
    now,
  })) return err("VALIDATION_ERROR", `Maximum ${policy.images_per_item} images per item`);

  try {
    const existing = await deps.mediaService.listLinkedMediaIds("storage_item", itemId, "image");
    const created = await deps.mediaService.createImages({ ownerUserId: actorId, purpose: "storage_image", uploads, now, maxBytes });
    await deps.mediaService.replace({
      entityType: "storage_item",
      entityId: itemId,
      slot: "image",
      media: [...existing, ...created.mediaIds].map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
      ownerUserId: actorId,
      now,
    });
    await deps.writeAuditLog({ entityType: "storage_item", action: "upload_images", actorId, entityId: itemId, diffTitle: item.name, detail: { count: uploads.length } });
    await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
    return ok(created.mediaIds.map((mediaId) => ({ media_id: mediaId })));
  } catch (error) {
    if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
    throw error;
  }
}

export async function deleteStorageImage(
  db: DrizzleDb,
  deps: StorageImageDeps,
  actorId: string,
  itemId: string,
  mediaId: string,
): Promise<ServiceResult<{ ok: true }>> {
  const item = await getItemRow(db, itemId);
  if (!item) return err("NOT_FOUND", "Item not found");
  const existing = await deps.mediaService.listLinkedMediaIds("storage_item", itemId, "image");
  if (!existing.includes(mediaId)) return err("NOT_FOUND", "Image not found");
  await deps.mediaService.replace({
    entityType: "storage_item",
    entityId: itemId,
    slot: "image",
    media: existing.filter((id) => id !== mediaId).map((id, sortOrder) => ({ mediaId: id, sortOrder })),
    ownerUserId: actorId,
    now: new Date().toISOString(),
  });
  await deps.writeAuditLog({ entityType: "storage_item", action: "delete_images", actorId, entityId: itemId, diffTitle: item.name, detail: { media_id: mediaId } });
  await deps.publishEntityChanged({ entityType: "storage", entityId: itemId, hint: "storage_updated" });
  return ok({ ok: true });
}
