import { galleryItemSchema } from "@guild/shared";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { galleryItems, users } from "../db/schema";
import { escapeLikePattern } from "./helpers";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { MediaValidationError } from "./MediaService";
import { err, ok, type ServiceResult } from "./result";

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

export type GalleryRow = {
  id: string;
  type: string;
  url: string | null;
  mediaId: string | null;
  caption: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
};

type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type GalleryServiceDeps = {
  mediaService: MediaService;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  rawDb: D1Database;
};

export function toGalleryPayload(row: GalleryRow) {
  return galleryItemSchema.parse({
    id: row.id,
    type: row.type,
    media_id: row.mediaId,
    url: row.url,
    caption: row.caption,
    uploaded_by: row.uploadedBy,
    uploaded_by_name: row.uploadedByName,
    created_at: row.createdAt,
  });
}

export class GalleryService {
  constructor(private readonly db: DrizzleDb, private readonly deps: GalleryServiceDeps) {}

  private async addMediaIds<T extends Omit<GalleryRow, "mediaId">>(rows: readonly T[]): Promise<GalleryRow[]> {
    const imageIds = rows.filter((row) => row.type === "image").map((row) => row.id);
    const links = await this.deps.mediaService.listLinkedMedia("gallery_item", imageIds, ["image"]);
    return rows.map((row) => ({
      ...row,
      mediaId: row.type === "image" ? (links.get(row.id)?.[0]?.mediaId ?? null) : null,
    }));
  }

  async getItemById(itemId: string): Promise<GalleryRow | null> {
    const row = (await this.db.select({
      id: galleryItems.id,
      type: galleryItems.type,
      url: galleryItems.url,
      caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy,
      uploadedByName: users.username,
      createdAt: galleryItems.createdAt,
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(eq(galleryItems.id, itemId)).limit(1))[0];
    if (!row) return null;
    return (await this.addMediaIds([row]))[0] ?? null;
  }

  async listItems(opts: { cursor: number; limit: number; type?: string; dateFrom?: string; dateTo?: string; search?: string; order: "asc" | "desc"; currentUserId?: string }): Promise<ServiceResult<{ data: unknown[]; next_cursor: string | null }>> {
    const filters: SQL<unknown>[] = [];
    if (opts.type) filters.push(eq(galleryItems.type, opts.type as typeof galleryItems.type.enumValues[number]));
    if (opts.dateFrom) filters.push(gte(galleryItems.createdAt, opts.dateFrom));
    if (opts.dateTo) filters.push(lte(galleryItems.createdAt, opts.dateTo));
    if (opts.search) {
      const pattern = `%${escapeLikePattern(opts.search)}%`;
      filters.push(or(sql`lower(coalesce(${galleryItems.caption}, '')) LIKE ${pattern} ESCAPE '\\'`, sql`lower(coalesce(${users.username}, '')) LIKE ${pattern} ESCAPE '\\'`) as SQL<unknown>);
    }
    const rows = await this.db.select({
      id: galleryItems.id,
      type: galleryItems.type,
      url: galleryItems.url,
      caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy,
      uploadedByName: users.username,
      createdAt: galleryItems.createdAt,
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(and(...filters))
      .orderBy(opts.order === "asc" ? asc(galleryItems.createdAt) : desc(galleryItems.createdAt), opts.order === "asc" ? asc(galleryItems.id) : desc(galleryItems.id))
      .limit(opts.limit + 1).offset(opts.cursor);
    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
    const withMedia = await this.addMediaIds(pageRows);
    return ok({ data: withMedia.map(toGalleryPayload), next_cursor: hasMore ? String(opts.cursor + opts.limit) : null });
  }

  async uploadImages(
    actorId: string,
    uploads: readonly ParsedImageMediaUpload[],
    captions: Array<string | null>,
    quota: number,
    maxBytes: number,
  ): Promise<ServiceResult<unknown[]>> {
    const now = new Date().toISOString();
    if (!await this.deps.mediaService.checkQuota({
      purpose: "gallery_image",
      ownerUserId: actorId,
      scope: { kind: "owner" },
      limit: quota,
      incomingCount: uploads.length,
      now,
    })) return err("VALIDATION_ERROR", `Gallery image quota is ${quota}`);

    try {
      const createdMedia = await this.deps.mediaService.createImages({ ownerUserId: actorId, purpose: "gallery_image", uploads, now, maxBytes });
      const itemIds = uploads.map(() => nanoid());
      try {
        await this.deps.rawDb.batch(itemIds.map((itemId, index) => this.deps.rawDb.prepare(
          "INSERT INTO gallery_items (id, type, url, caption, uploaded_by) VALUES (?1, 'image', NULL, ?2, ?3)",
        ).bind(itemId, captions[index] ?? null, actorId)));
        for (let index = 0; index < itemIds.length; index += 1) {
          await this.deps.mediaService.replace({
            entityType: "gallery_item",
            entityId: itemIds[index]!,
            slot: "image",
            media: [{ mediaId: createdMedia.mediaIds[index]!, sortOrder: 0 }],
            ownerUserId: actorId,
            now,
          });
        }
      } catch (error) {
        try {
          await this.db.delete(galleryItems).where(inArray(galleryItems.id, itemIds));
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Gallery upload and domain cleanup both failed");
        }
        throw error;
      }
      const created = await Promise.all(itemIds.map((id) => this.getItemById(id)));
      const rows = created.filter((row): row is GalleryRow => row !== null);
      await this.deps.writeAuditLog({ entityType: "gallery_item", action: "upload_images", actorId, entityId: "batch", diffTitle: `${rows.length} items`, detail: { count: rows.length, captioned_count: rows.filter((item) => Boolean(item.caption)).length } });
      await this.deps.publishEntityChanged({ entityType: "gallery", entityId: "batch", hint: "images_uploaded" });
      return ok(rows.map(toGalleryPayload));
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  async createVideo(actorId: string, url: string, caption: string | null): Promise<ServiceResult<unknown>> {
    const itemId = nanoid();
    await this.db.insert(galleryItems).values({ id: itemId, type: "video", url, caption, uploadedBy: actorId });
    const created = await this.getItemById(itemId);
    if (!created) return err("SERVER_ERROR", "Failed to create gallery item");
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "create_video", actorId, entityId: itemId, diffTitle: caption ?? url });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: itemId, hint: "video_created" });
    return ok(toGalleryPayload(created));
  }

  async deleteItem(actorId: string, canDeleteAny: boolean, itemId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getItemById(itemId);
    if (!existing) return err("NOT_FOUND", "Gallery item not found");
    if (existing.uploadedBy !== actorId && !canDeleteAny) return err("FORBIDDEN", "Cannot delete this gallery item");
    await this.db.delete(galleryItems).where(eq(galleryItems.id, itemId));
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "delete", actorId, entityId: itemId, diffTitle: existing.caption ?? existing.type });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: itemId, hint: "item_deleted" });
    return ok({ ok: true });
  }

  async batchDelete(actorId: string, ids: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    const items = await this.db.select({ id: galleryItems.id }).from(galleryItems).where(inArray(galleryItems.id, ids));
    if (items.length === 0) return ok({ ok: true, deleted: 0 });
    await this.db.delete(galleryItems).where(inArray(galleryItems.id, items.map((item) => item.id)));
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "batch_delete", actorId, entityId: items.map((item) => item.id).join(","), diffTitle: `${items.length} items`, detail: { count: items.length, ids: items.map((item) => item.id) } });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: "batch", hint: "items_deleted" });
    return ok({ ok: true, deleted: items.length });
  }
}
