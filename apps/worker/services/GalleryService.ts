import {
  galleryCommentSchema,
  galleryItemSchema,
} from "@guild/shared";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { galleryComments, galleryItems, galleryLikes, users } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type AuditLogInput = { entityType: string; action: string; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };

export type GalleryRow = {
  id: string;
  type: string;
  url: string;
  caption: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean | number | null;
};

type EntityChangedInput = { entityType: string; entityId: string; hint: string };

export type GalleryServiceDeps = {
  media: R2Bucket;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
};

// --- Helpers ---

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function toGalleryPayload(row: GalleryRow) {
  const isLiked = row.isLiked === null || row.isLiked === undefined ? false : Boolean(row.isLiked);
  return galleryItemSchema.parse({
    id: row.id, type: row.type, url: row.url, caption: row.caption,
    uploaded_by: row.uploadedBy, uploaded_by_name: row.uploadedByName,
    like_count: row.likeCount ?? 0, comment_count: row.commentCount ?? 0,
    is_liked: isLiked, created_at: row.createdAt,
  });
}

function toCommentPayload(row: { id: string; galleryItemId: string; userId: string; username: string | null; body: string; createdAt: string; updatedAt: string }) {
  return galleryCommentSchema.parse({
    id: row.id, gallery_item_id: row.galleryItemId, user_id: row.userId,
    username: row.username, body: row.body, created_at: row.createdAt, updated_at: row.updatedAt,
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

  async getItemById(itemId: string, currentUserId?: string): Promise<GalleryRow | null> {
    const row = (await this.db.select({
      id: galleryItems.id, type: galleryItems.type, url: galleryItems.url, caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy, uploadedByName: users.username, createdAt: galleryItems.createdAt,
      likeCount: sql<number>`(SELECT COUNT(*) FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id})`,
      commentCount: sql<number>`(SELECT COUNT(*) FROM gallery_comments WHERE gallery_item_id = ${galleryItems.id})`,
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(eq(galleryItems.id, itemId)).limit(1))[0];
    if (!row) return null;
    let isLiked = false;
    if (currentUserId) {
      const like = await this.db.select({ id: galleryLikes.id }).from(galleryLikes).where(and(eq(galleryLikes.galleryItemId, itemId), eq(galleryLikes.userId, currentUserId))).limit(1);
      isLiked = like.length > 0;
    }
    return { ...row, isLiked };
  }

  private async getCommentById(commentId: string) {
    return (await this.db.select({ id: galleryComments.id, galleryItemId: galleryComments.galleryItemId, userId: galleryComments.userId, username: users.username, body: galleryComments.body, createdAt: galleryComments.createdAt, updatedAt: galleryComments.updatedAt }).from(galleryComments).leftJoin(users, eq(users.id, galleryComments.userId)).where(eq(galleryComments.id, commentId)).limit(1))[0] ?? null;
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
      likeCount: sql<number>`(SELECT COUNT(*) FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id})`,
      commentCount: sql<number>`(SELECT COUNT(*) FROM gallery_comments WHERE gallery_item_id = ${galleryItems.id})`,
      ...(opts.currentUserId ? { isLiked: sql<boolean>`EXISTS(SELECT 1 FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id} AND user_id = ${opts.currentUserId})` } : {}),
    }).from(galleryItems).leftJoin(users, eq(users.id, galleryItems.uploadedBy)).where(whereClause)
      .orderBy(opts.order === "asc" ? asc(galleryItems.createdAt) : desc(galleryItems.createdAt), opts.order === "asc" ? asc(galleryItems.id) : desc(galleryItems.id))
      .limit(opts.limit + 1).offset(opts.cursor);
    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
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
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "upload_images", actorId, entityId: "batch", detailText: JSON.stringify({ count: created.length, captioned_count: created.filter((item) => Boolean(item.caption)).length }) });
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

  async deleteItem(actorId: string, itemId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getItemById(itemId);
    if (!existing) return err("NOT_FOUND", "Gallery item not found");
    await this.db.delete(galleryItems).where(eq(galleryItems.id, itemId));
    if (existing.type === "image") await this.deps.media.delete(existing.url);
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "delete", actorId, entityId: itemId, diffTitle: existing.caption });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: itemId, hint: "item_deleted" });
    return ok({ ok: true });
  }

  async batchDelete(actorId: string, ids: string[]): Promise<ServiceResult<{ ok: true; deleted: number }>> {
    const items = await this.db.select({ id: galleryItems.id, type: galleryItems.type, url: galleryItems.url, caption: galleryItems.caption }).from(galleryItems).where(inArray(galleryItems.id, ids));
    if (items.length === 0) return ok({ ok: true, deleted: 0 });
    const itemIds = items.map((item) => item.id);
    await this.db.delete(galleryComments).where(inArray(galleryComments.galleryItemId, itemIds));
    await this.db.delete(galleryLikes).where(inArray(galleryLikes.galleryItemId, itemIds));
    await this.db.delete(galleryItems).where(inArray(galleryItems.id, itemIds));
    for (const item of items) {
      if (item.type === "image") await this.deps.media.delete(item.url);
    }
    await this.deps.writeAuditLog({ entityType: "gallery_item", action: "batch_delete", actorId, entityId: itemIds.join(","), detailText: JSON.stringify({ count: items.length, ids: itemIds }) });
    await this.deps.publishEntityChanged({ entityType: "gallery", entityId: "batch", hint: "items_deleted" });
    return ok({ ok: true, deleted: items.length });
  }

  async likeItem(actorId: string, itemId: string): Promise<ServiceResult<{ ok: true; already_liked: boolean }>> {
    const existing = await this.getItemById(itemId);
    if (!existing) return err("NOT_FOUND", "Gallery item not found");
    try {
      await this.db.insert(galleryLikes).values({ id: nanoid(), galleryItemId: itemId, userId: actorId });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE")) return ok({ ok: true, already_liked: true });
      throw e;
    }
    return ok({ ok: true, already_liked: false });
  }

  async listComments(itemId: string, cursor: number, limit: number): Promise<ServiceResult<{ data: unknown[]; next_cursor: string | null }>> {
    const item = await this.db.select({ id: galleryItems.id }).from(galleryItems).where(eq(galleryItems.id, itemId)).limit(1);
    if (item.length === 0) return err("NOT_FOUND", "Gallery item not found");
    const rows = await this.db.select({ id: galleryComments.id, galleryItemId: galleryComments.galleryItemId, userId: galleryComments.userId, username: users.username, body: galleryComments.body, createdAt: galleryComments.createdAt, updatedAt: galleryComments.updatedAt }).from(galleryComments).leftJoin(users, eq(users.id, galleryComments.userId)).where(eq(galleryComments.galleryItemId, itemId)).orderBy(asc(galleryComments.createdAt), asc(galleryComments.id)).limit(limit + 1).offset(cursor);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return ok({ data: pageRows.map(toCommentPayload), next_cursor: hasMore ? String(cursor + limit) : null });
  }

  async createComment(actorId: string, itemId: string, body: string): Promise<ServiceResult<unknown>> {
    const existing = await this.getItemById(itemId);
    if (!existing) return err("NOT_FOUND", "Gallery item not found");
    const commentId = nanoid();
    await this.db.insert(galleryComments).values({ id: commentId, galleryItemId: itemId, userId: actorId, body });
    const comment = await this.getCommentById(commentId);
    if (!comment) return err("SERVER_ERROR", "Failed to create comment");
    await this.deps.writeAuditLog({ entityType: "gallery_comment", action: "create", actorId, entityId: commentId, detailText: `on gallery item ${itemId}` });
    return ok(toCommentPayload(comment));
  }

  async updateComment(actorId: string, commentId: string, body: string): Promise<ServiceResult<unknown>> {
    const existing = (await this.db.select({ id: galleryComments.id, userId: galleryComments.userId }).from(galleryComments).where(eq(galleryComments.id, commentId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Comment not found");
    if (existing.userId !== actorId) return err("FORBIDDEN", "You can only edit your own comments");
    await this.db.update(galleryComments).set({ body, updatedAt: new Date().toISOString() }).where(eq(galleryComments.id, commentId));
    const updated = await this.getCommentById(commentId);
    if (!updated) return err("SERVER_ERROR", "Failed to update comment");
    return ok(toCommentPayload(updated));
  }

  async deleteComment(actorId: string, canManage: boolean, commentId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = (await this.db.select({ id: galleryComments.id, userId: galleryComments.userId, galleryItemId: galleryComments.galleryItemId }).from(galleryComments).where(eq(galleryComments.id, commentId)).limit(1))[0];
    if (!existing) return err("NOT_FOUND", "Comment not found");
    if (existing.userId !== actorId && !canManage) return err("FORBIDDEN", "Cannot delete this comment");
    await this.db.delete(galleryComments).where(eq(galleryComments.id, commentId));
    await this.deps.writeAuditLog({ entityType: "gallery_comment", action: "delete", actorId, entityId: commentId, detailText: `on gallery item ${existing.galleryItemId}` });
    return ok({ ok: true });
  }
}
