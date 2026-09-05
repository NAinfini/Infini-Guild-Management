import { galleryItemEtag, type AuditChange, type CursorResponse, type GalleryItem } from "@guild/shared";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { galleryVideoHost } from "@guild/shared/utils/video";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { PushHint } from "@guild/shared/constants/push-hints";
import { nanoid } from "nanoid";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";
import type { ImageUpload, MediaService } from "../media/public.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

export type GalleryCursor = Readonly<{ createdAt: string; id: string; order: "asc" | "desc" }>;
type WithoutGalleryRevision<T> = T extends unknown ? Omit<T, "revision_token"> : never;
export type GalleryRecord = WithoutGalleryRevision<GalleryItem> & Readonly<{ revisionToken: string }>;
export type GalleryImageMetadata = Readonly<{ title: string; description: string | null }>;
export type GalleryLikeWriteResult =
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "ok"; changed: boolean; likeCount: number }>;

export type GalleryListQuery = Readonly<{
  cursor: GalleryCursor | null;
  limit: number;
  type?: "image" | "video";
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  order: "asc" | "desc";
  viewerUserId: string | null;
}>;

export interface GalleryStore {
  list(query: GalleryListQuery): Promise<Readonly<{ data: readonly GalleryRecord[]; hasMore: boolean }>>;
  get(id: string, viewerUserId: string | null): Promise<GalleryRecord | null>;
  createImages(input: Readonly<{
    records: readonly GalleryRecord[];
    mediaIds: readonly string[];
    ownerUserId: string;
    maxItems: number;
    audit: AuditEventWrite;
  }>): Promise<void>;
  createVideo(input: Readonly<{ record: GalleryRecord; audit: AuditEventWrite }>): Promise<void>;
  updateMetadata(input: Readonly<{
    id: string;
    expectedRevisionToken: string;
    newRevisionToken: string;
    title: string;
    description: string | null;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  delete(input: Readonly<{
    id: string;
    expectedRevisionToken: string;
    mutationToken: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  batchDelete(input: Readonly<{
    ids: readonly string[];
    mutationToken: string;
    audit: AuditEventWrite;
  }>): Promise<number>;
  setLike(input: Readonly<{
    id: string;
    userId: string;
    liked: boolean;
    audit: AuditEventWrite;
  }>): Promise<GalleryLikeWriteResult>;
}

export class GalleryService {
  constructor(
    private readonly store: GalleryStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  async list(context: RequestContext, input: Readonly<{
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
      viewerUserId: context.authorization.actor?.userId ?? null,
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
    metadata: readonly GalleryImageMetadata[],
    maxBytes: number,
    quota: number,
  ): Promise<Readonly<{ data: readonly GalleryItem[] }>> {
    const actor = context.authorization.require(PERMISSION_ID.GALLERY_UPLOAD);
    if (uploads.length < 1 || uploads.length !== metadata.length) throw validation("Gallery images and metadata must be aligned");
    if (uploads.length > quota) throw validation(`Gallery image quota is ${quota}`);
    const mediaIds = await this.media.uploadImages(context, "gallery_image", uploads, maxBytes);
    const records = mediaIds.map<GalleryRecord>((mediaId, index) => ({
      id: nanoid(),
      type: "image",
      media_id: mediaId,
      url: null,
      title: normalizeTitle(metadata[index]?.title),
      description: normalizeDescription(metadata[index]?.description),
      uploaded_by: actor.userId,
      uploaded_by_name: null,
      like_count: 0,
      liked_by_viewer: false,
      created_at: context.now,
      revisionToken: crypto.randomUUID(),
    }));
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      // The frozen cleanup trigger resolves this ID list; nanoid excludes commas and JSON delimiters.
      subjectId: records.map(({ id }) => id).join(","),
      subjectLabel: "image",
      action: "upload_images",
      context: [
        { field: "item_count", value: { type: "number", value: records.length } },
        {
          field: "item_ids",
          value: {
            type: "list",
            value: records.map(({ id, title }) => ({
              type: "reference" as const,
              value: { id, label: title },
            })),
          },
        },
      ],
    });
    await this.store.createImages({ records, mediaIds, ownerUserId: actor.userId, maxItems: quota, audit });
    this.publish("batch", "images_uploaded", context.now);
    return { data: records.map(withoutRevision) };
  }

  async createVideo(
    context: RequestContext,
    input: Readonly<{ url: string; title: string; description?: string | null }>,
  ): Promise<GalleryItem> {
    const actor = context.authorization.require(PERMISSION_ID.GALLERY_UPLOAD);
    const host = galleryVideoHost(input.url);
    if (!host) throw validation("Video URL must use an allowed host");
    const record: GalleryRecord = {
      id: nanoid(),
      type: "video",
      media_id: null,
      url: input.url,
      title: normalizeTitle(input.title),
      description: normalizeDescription(input.description),
      uploaded_by: actor.userId,
      uploaded_by_name: null,
      like_count: 0,
      liked_by_viewer: false,
      created_at: context.now,
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "create_video",
      // The URL itself never enters an audit record; the provider is what the log needs to explain the entry.
      context: [{ field: "video_host", value: { type: "text", value: host } }],
    });
    await this.store.createVideo({ record, audit });
    this.publish(record.id, "video_created", context.now);
    return withoutRevision(record);
  }

  async update(
    context: RequestContext,
    id: string,
    input: Readonly<{ title: string; description?: string | null }>,
    expectedEtag: string,
  ): Promise<GalleryItem> {
    const actor = context.authorization.requireAuthenticated();
    const record = await this.store.get(id, actor.userId);
    if (!record) throw galleryNotFound();
    if (record.uploaded_by !== actor.userId && !context.authorization.has(PERMISSION_ID.GALLERY_MANAGE)) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Cannot edit this gallery item" });
    }
    if (expectedEtag !== galleryItemEtag({ id: record.id, revision_token: record.revisionToken })) {
      throw galleryUpdateConflict();
    }

    const title = normalizeTitle(input.title);
    const description = input.description === undefined
      ? record.description
      : normalizeDescription(input.description);
    if (title === record.title && description === record.description) return withoutRevision(record);

    const changes: AuditChange[] = [];
    if (title !== record.title) {
      changes.push({
        field: "title",
        before: { type: "text", value: record.title },
        after: { type: "text", value: title },
      });
    }
    if (description !== record.description) {
      changes.push({
        field: "description",
        before: record.description === null
          ? { type: "null", value: null }
          : { type: "text", value: record.description },
        after: description === null
          ? { type: "null", value: null }
          : { type: "text", value: description },
      });
    }

    const newRevisionToken = crypto.randomUUID();
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      subjectId: id,
      subjectLabel: title,
      action: "update",
      changes,
    });
    if (!await this.store.updateMetadata({
      id,
      expectedRevisionToken: record.revisionToken,
      newRevisionToken,
      title,
      description,
      audit,
    })) throw galleryUpdateConflict();

    const updated = { ...record, title, description, revisionToken: newRevisionToken };
    this.publish(id, "item_updated", context.now);
    return withoutRevision(updated);
  }

  async delete(
    context: RequestContext,
    id: string,
    expectedEtag: string,
  ): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.requireAuthenticated();
    const record = await this.store.get(id, actor.userId);
    if (!record) throw new AppError({ code: "NOT_FOUND", status: 404, message: "Gallery item not found" });
    if (record.uploaded_by !== actor.userId && !context.authorization.has(PERMISSION_ID.GALLERY_DELETE)) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Cannot delete this gallery item" });
    }
    if (expectedEtag !== galleryItemEtag({ id: record.id, revision_token: record.revisionToken })) {
      throw new AppError({ code: "CONFLICT", status: 409, message: "Gallery item changed before deletion" });
    }
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      subjectId: id,
      subjectLabel: record.title,
      action: "delete",
      context: [{ field: "type", value: { type: "code", value: record.type } }],
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
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      subjectId: context.requestId,
      subjectLabel: "Gallery items",
      action: "batch_delete",
      // The store appends the items it actually removed; a requested count here would contradict it.
    });
    const deleted = await this.store.batchDelete({ ids, mutationToken: crypto.randomUUID(), audit });
    if (deleted > 0) this.publish("batch", "items_deleted", context.now);
    return { ok: true, deleted };
  }

  like(context: RequestContext, id: string): Promise<Readonly<{ liked: boolean; like_count: number }>> {
    return this.setLike(context, id, true);
  }

  unlike(context: RequestContext, id: string): Promise<Readonly<{ liked: boolean; like_count: number }>> {
    return this.setLike(context, id, false);
  }

  private async setLike(
    context: RequestContext,
    id: string,
    liked: boolean,
  ): Promise<Readonly<{ liked: boolean; like_count: number }>> {
    const actor = context.authorization.requireAuthenticated();
    const record = await this.store.get(id, actor.userId);
    if (!record) throw galleryNotFound();
    const audit = createAuditEvent(context, {
      subjectType: "gallery_item",
      subjectId: id,
      subjectLabel: record.title,
      action: "update",
      changes: [{
        field: "liked",
        before: { type: "boolean", value: !liked },
        after: { type: "boolean", value: liked },
      }],
    });
    const result = await this.store.setLike({ id, userId: actor.userId, liked, audit });
    if (result.outcome === "not_found") throw galleryNotFound();
    if (result.changed) this.publish(id, liked ? "item_liked" : "item_unliked", context.now);
    return { liked, like_count: result.likeCount };
  }

  private publish(id: string, hint: PushHint, updatedAt: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "gallery",
      entity_id: id,
      updated_at: updatedAt,
      hint,
    }));
  }
}

function normalizeTitle(value: string | null | undefined): string {
  const title = value?.trim() ?? "";
  if (!title || title.length > 100) throw validation("Gallery title is invalid");
  return title;
}

function normalizeDescription(value: string | null | undefined): string | null {
  const description = value?.trim() ?? "";
  if (description.length > 200) throw validation("Gallery description is too long");
  return description || null;
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
  return { ...item, revision_token: record.revisionToken };
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function galleryNotFound(): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message: "Gallery item not found" });
}

function galleryUpdateConflict(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Gallery item changed before update" });
}
