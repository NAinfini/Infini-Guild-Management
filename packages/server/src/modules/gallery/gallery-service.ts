import type { CursorResponse, GalleryItem } from "@guild/shared";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { isAllowedGalleryVideoUrl } from "@guild/shared/utils/video";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { nanoid } from "nanoid";
import { createAuditMutation, type AuditMutation } from "../audit/public.js";
import type { ImageUpload, MediaService } from "../media/public.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

export type GalleryCursor = Readonly<{ createdAt: string; id: string; order: "asc" | "desc" }>;
export type GalleryRecord = GalleryItem & Readonly<{ revisionToken: string }>;

export type GalleryListQuery = Readonly<{
  cursor: GalleryCursor | null;
  limit: number;
  type?: "image" | "video";
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  order: "asc" | "desc";
}>;

export interface GalleryStore {
  list(query: GalleryListQuery): Promise<Readonly<{ data: readonly GalleryRecord[]; hasMore: boolean }>>;
  get(id: string): Promise<GalleryRecord | null>;
  createImages(input: Readonly<{
    records: readonly GalleryRecord[];
    mediaIds: readonly string[];
    ownerUserId: string;
    maxItems: number;
    audit: AuditMutation;
  }>): Promise<void>;
  createVideo(input: Readonly<{ record: GalleryRecord; audit: AuditMutation }>): Promise<void>;
  delete(input: Readonly<{
    id: string;
    expectedRevisionToken: string;
    mutationToken: string;
    audit: AuditMutation;
  }>): Promise<boolean>;
  batchDelete(input: Readonly<{
    ids: readonly string[];
    mutationToken: string;
    audit: AuditMutation;
  }>): Promise<number>;
}

export class GalleryService {
  constructor(
    private readonly store: GalleryStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  async list(_context: RequestContext, input: Readonly<{
    cursor?: string;
    limit: number;
    type?: "image" | "video";
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    order: "asc" | "desc";
  }>): Promise<CursorResponse<GalleryItem>> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw validation("Invalid gallery limit");
    assertPortableLikeSearch(input.search?.toLowerCase(), "Gallery search");
    const cursor = input.cursor ? decodeCursor(input.cursor, input.order) : null;
    const result = await this.store.list({
      cursor,
      limit: input.limit,
      type: input.type,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      search: input.search,
      order: input.order,
    });
    const data = result.data.map(withoutRevision);
    const last = result.data.at(-1);
    return {
      data,
      next_cursor: result.hasMore && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id, order: input.order })
        : null,
    };
  }

  async uploadImages(
    context: RequestContext,
    uploads: readonly ImageUpload[],
    captions: readonly (string | null)[],
    maxBytes: number,
    quota: number,
  ): Promise<Readonly<{ data: readonly GalleryItem[] }>> {
    const actor = context.authorization.require(PERMISSION_ID.GALLERY_UPLOAD);
    if (uploads.length < 1 || uploads.length !== captions.length) throw validation("Gallery images and captions must be aligned");
    if (uploads.length > quota) throw validation(`Gallery image quota is ${quota}`);
    const mediaIds = await this.media.uploadImages(context, "gallery_image", uploads, maxBytes);
    const records = mediaIds.map<GalleryRecord>((mediaId, index) => ({
      id: nanoid(),
      type: "image",
      media_id: mediaId,
      url: null,
      caption: normalizeCaption(captions[index]),
      uploaded_by: actor.userId,
      uploaded_by_name: null,
      created_at: context.now,
      revisionToken: crypto.randomUUID(),
    }));
    const audit = createAuditMutation(context, {
      entityType: "gallery_item",
      entityId: records.map((record) => record.id).join(","),
      action: "upload_images",
      summary: `${records.length} items`,
      details: { count: records.length },
    });
    await this.store.createImages({ records, mediaIds, ownerUserId: actor.userId, maxItems: quota, audit });
    this.publish("batch", "images_uploaded", context.now);
    return { data: records.map(withoutRevision) };
  }

  async createVideo(
    context: RequestContext,
    input: Readonly<{ url: string; caption?: string }>,
  ): Promise<GalleryItem> {
    const actor = context.authorization.require(PERMISSION_ID.GALLERY_UPLOAD);
    if (!isAllowedGalleryVideoUrl(input.url)) throw validation("Video URL must use an allowed host");
    const record: GalleryRecord = {
      id: nanoid(),
      type: "video",
      media_id: null,
      url: input.url,
      caption: normalizeCaption(input.caption),
      uploaded_by: actor.userId,
      uploaded_by_name: null,
      created_at: context.now,
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditMutation(context, {
      entityType: "gallery_item",
      entityId: record.id,
      action: "create_video",
      summary: record.caption ?? record.url,
    });
    await this.store.createVideo({ record, audit });
    this.publish(record.id, "video_created", context.now);
    return withoutRevision(record);
  }

  async delete(context: RequestContext, id: string): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.requireAuthenticated();
    const record = await this.store.get(id);
    if (!record) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Gallery item not found" });
    if (record.uploaded_by !== actor.userId && !context.authorization.has(PERMISSION_ID.GALLERY_DELETE)) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Cannot delete this gallery item" });
    }
    const audit = createAuditMutation(context, {
      entityType: "gallery_item",
      entityId: id,
      action: "delete",
      summary: record.caption ?? record.type,
    });
    if (!await this.store.delete({
      id,
      expectedRevisionToken: record.revisionToken,
      mutationToken: crypto.randomUUID(),
      audit,
    })) throw new AppError({ code: "CONFLICT", status: 409, message: "Gallery item changed before deletion" });
    this.publish(id, "item_deleted", context.now);
    return { ok: true };
  }

  async batchDelete(context: RequestContext, idsInput: readonly string[]): Promise<Readonly<{ ok: true; deleted: number }>> {
    context.authorization.require(PERMISSION_ID.GALLERY_DELETE);
    const ids = [...new Set(idsInput)];
    if (ids.length < 1 || ids.length > 50 || ids.length !== idsInput.length) throw validation("Batch delete requires 1 to 50 unique gallery ids");
    const audit = createAuditMutation(context, {
      entityType: "gallery_item",
      entityId: ids.join(","),
      action: "batch_delete",
      summary: `${ids.length} requested items`,
      details: { ids },
    });
    const deleted = await this.store.batchDelete({ ids, mutationToken: crypto.randomUUID(), audit });
    if (deleted > 0) this.publish("batch", "items_deleted", context.now);
    return { ok: true, deleted };
  }

  private publish(id: string, hint: string, updatedAt: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "gallery",
      entity_id: id,
      updated_at: updatedAt,
      hint,
    }));
  }
}

function normalizeCaption(value: string | null | undefined): string | null {
  const caption = value?.trim() ?? "";
  if (caption.length > 200) throw validation("Gallery caption is too long");
  return caption || null;
}

function encodeCursor(cursor: GalleryCursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

function decodeCursor(value: string, order: "asc" | "desc"): GalleryCursor {
  if (value.length > 512) throw validation("Invalid gallery cursor");
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<GalleryCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || parsed.order !== order) throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id, order };
  } catch {
    throw validation("Invalid gallery cursor");
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function withoutRevision(record: GalleryRecord): GalleryItem {
  const { revisionToken: _revisionToken, ...item } = record;
  return item;
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
