import { galleryItemSchema } from "@guild/shared";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { galleryItems, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern } from "./helpers";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type AuditLogInput = { entityType: AuditEntityType; action: AuditAction; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };

export type GalleryRow = {
  id: string;
  type: string;
  url: string;
  caption: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
};

type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type GalleryServiceDeps = {
  media: R2Bucket;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  rawDb: D1Database;
};

// --- Helpers ---

export function toGalleryPayload(row: GalleryRow) {
  return galleryItemSchema.parse({
    id: row.id, type: row.type, url: row.url, caption: row.caption,
    uploaded_by: row.uploadedBy, uploaded_by_name: row.uploadedByName,
    created_at: row.createdAt,
  });
}

// --- Service ---

export class GalleryService {
  private db: DrizzleDb;
  private deps: GalleryServiceDeps;

  constructor(db: DrizzleDb, deps: GalleryServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  // --- Private helpers ---

  async getItemById(itemId: string): Promise<GalleryRow | null> {
    const row = (await this.db.select({
      id: galleryItems.id, type: galleryItems.type, url: galleryItems.url, caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy, uploadedByName: users.username, createdAt: galleryItems.createdAt,
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(eq(galleryItems.id, itemId)).limit(1))[0];
    if (!row) return null;
    return row;
  }

  // --- Public methods ---

  async listItems(opts: { cursor: number; limit: number; type?: string; dateFrom?: string; dateTo?: string; search?: string; order: "asc" | "desc"; currentUserId?: string }): Promise<ServiceResult<{ data: unknown[]; next_cursor: string | null }>> {
    const filters: SQL<unknown>[] = [];
    if (opts.type) filters.push(eq(galleryItems.type, opts.type as typeof galleryItems.type.enumValues[number]));
    if (opts.dateFrom) filters.push(gte(galleryItems.createdAt, opts.dateFrom));
    if (opts.dateTo) filters.push(lte(galleryItems.createdAt, opts.dateTo));
    if (opts.search) {
      const pattern = `%${escapeLikePattern(opts.search)}%`;
      filters.push(or(sql`lower(coalesce(${galleryItems.caption}, '')) LIKE ${pattern} ESCAPE '\\'`, sql`lower(coalesce(${users.username}, '')) LIKE ${pattern} ESCAPE '\\'`) as SQL<unknown>);
    }
    const whereClause = and(...filters);
    const rows = await this.db.select({
      id: galleryItems.id, type: galleryItems.type, url: galleryItems.url, caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy, uploadedByName: users.username, createdAt: galleryItems.createdAt,
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(whereClause)
      .orderBy(opts.order === "asc" ? asc(galleryItems.createdAt) : desc(galleryItems.createdAt), opts.order === "asc" ? asc(galleryItems.id) : desc(galleryItems.id))
      .limit(opts.limit + 1).offset(opts.cursor);
    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;

    if (pageRows.length === 0) {
      return ok({ data: [], next_cursor: null });
    }

    return ok({ data: pageRows.map(toGalleryPayload), next_cursor: hasMore ? String(opts.cursor + opts.limit) : null });
  }

  async uploadImages(actorId: string, files: Array<{ data: ArrayBuffer; contentType: string; name: string }>, captions: Array<string | null>): Promise<ServiceResult<unknown[]>> {
    const created: GalleryRow[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      const caption = captions[i] ?? null;
      const itemId = nanoid();
      const key = `gallery/images/${actorId}/${Date.now()}_${itemId}`;
      const putResult = await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      if (!putResult) return err("SERVER_ERROR", "Failed to upload media file");
      await this.db.insert(galleryItems).values({ id: itemId, type: "image", url: key, caption, uploadedBy: actorId });
      created.push({ id: itemId, type: "image", url: key, caption, uploadedBy: actorId, uploadedByName: null, createdAt: new Date().toISOString() });
    }
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "upload_images", actorId, entityId: "batch", diffTitle: `${created.length} items`, detailText: JSON.stringify({ count: created.length, captioned_count: created.filter((item) => Boolean(item.caption)).length }) });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: "batch", hint: "images_uploaded" });
    return ok(created.map(toGalleryPayload));
  }

  async createVideo(actorId: string, url: string, caption: string | null): Promise<ServiceResult<unknown>> {
    const itemId = nanoid();
    await this.db.insert(galleryItems).values({ id: itemId, type: "video", url, caption, uploadedBy: actorId });
    const created = await this.getItemById(itemId);
    if (!created) return err("SERVER_ERROR", "Failed to create gallery item");
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "create_video", actorId, entityId: itemId, diffTitle: caption });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: itemId, hint: "video_created" });
    return ok(toGalleryPayload(created));
  }

  async deleteItem(actorId: string, canDeleteAny: boolean, itemId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getItemById(itemId);
    if (!existing) return err("NOT_FOUND", "Gallery item not found");
    if (existing.uploadedBy !== actorId && !canDeleteAny) return err("FORBIDDEN", "Cannot delete this gallery item");
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("DELETE FROM gallery_items WHERE id = ?1").bind(itemId),
    ]);
    if (existing.type === "image") await this.deps.media.delete(existing.url);
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "delete", actorId, entityId: itemId, diffTitle: existing.caption });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: itemId, hint: "item_deleted" });
    return ok({ ok: true });
  }

  async batchDelete(actorId: string, ids: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    const items = await this.db.select({ id: galleryItems.id, type: galleryItems.type, url: galleryItems.url, caption: galleryItems.caption }).from(galleryItems).where(inArray(galleryItems.id, ids));
    if (items.length === 0) return ok({ ok: true, deleted: 0 });
    const itemIds = items.map((item) => item.id);
    const placeholders = itemIds.map(() => "?").join(",");
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare(`DELETE FROM gallery_items WHERE id IN (${placeholders})`).bind(...itemIds),
    ]);
    for (const item of items) {
      if (item.type === "image") await this.deps.media.delete(item.url);
    }
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "batch_delete", actorId, entityId: itemIds.join(","), diffTitle: `${items.length} items`, detailText: JSON.stringify({ count: items.length, ids: itemIds }) });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: "batch", hint: "items_deleted" });
    return ok({ ok: true, deleted: items.length });
  }
}
