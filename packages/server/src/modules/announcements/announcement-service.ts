import { announcementEtag, MAX_OFFSET_PAGE, type Announcement, type AnnouncementAttachment, type AnnouncementSummary, type AuditChange, type PaginatedResponse } from "@guild/shared";
import type { AnnouncementCategory, AnnouncementStatus } from "@guild/shared/constants/announcements";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import { AppError } from "@guild/kernel";
import { nanoid } from "nanoid";
import { createAuditEvent, type AuditEventWrite } from "../audit/public.js";
import {
  canonicalizeRichTextMedia,
  extractRichTextMediaIds,
  type FileUpload,
  type ImageUpload,
  type MediaService,
} from "../media/public.js";
import { assertPortableLikeSearch } from "../../portable-search.js";
import { contentReadScopes, type ContentReadScope } from "../../content-read-scope.js";

export type AnnouncementRecord = Omit<Announcement, "author" | "attachments" | "excerpt" | "preview_media_id"> & Readonly<{ revisionToken: string }>;
export type AnnouncementDetailRecord = Announcement & Readonly<{ revisionToken: string }>;

export type AnnouncementListQuery = Readonly<{
  page: number;
  limit: number;
  status?: AnnouncementStatus;
  category?: AnnouncementCategory;
  pinned?: boolean;
  search?: string;
  sort: "updated_desc" | "updated_asc";
  readScope: ContentReadScope;
  now: string;
}>;

export interface AnnouncementStore {
  list(query: AnnouncementListQuery): Promise<PaginatedResponse<AnnouncementSummary>>;
  get(id: string, readScope: ContentReadScope, now: string): Promise<AnnouncementDetailRecord | null>;
  incrementView(id: string, readScope: ContentReadScope, now: string): Promise<number | null>;
  create(input: Readonly<{
    record: AnnouncementRecord;
    mediaIds: readonly string[];
    attachmentMediaIds: readonly string[];
    maxItems: number;
    maxAttachmentItems: number;
    audit: AuditEventWrite;
  }>): Promise<AnnouncementDetailRecord>;
  update(input: Readonly<{
    record: AnnouncementRecord;
    expectedRevisionToken: string;
    mediaIds: readonly string[] | null;
    attachmentMediaIds: readonly string[] | null;
    maxItems: number;
    maxAttachmentItems: number;
    audit: AuditEventWrite;
  }>): Promise<AnnouncementDetailRecord | null>;
  archive(input: Readonly<{
    id: string;
    expectedRevisionToken: string;
    revisionToken: string;
    updatedAt: string;
    actorUserId: string;
    audit: AuditEventWrite;
  }>): Promise<boolean>;
  delete(input: Readonly<{ id: string; expectedRevisionToken: string; mutationToken: string; audit: AuditEventWrite }>): Promise<boolean>;
}

export type CreateAnnouncementInput = Readonly<{
  title: string;
  body_json: string;
  category: AnnouncementCategory;
  pinned: boolean;
  status: AnnouncementStatus;
  publish_at?: string | null;
  attachment_media_ids?: readonly string[];
}>;

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>;

export class AnnouncementService {
  constructor(
    private readonly store: AnnouncementStore,
    private readonly media: MediaService,
    private readonly notifications: NotificationPublisher,
    private readonly deferred: DeferredTasks,
  ) {}

  list(context: RequestContext, query: Omit<AnnouncementListQuery, "readScope" | "now">): Promise<PaginatedResponse<AnnouncementSummary>> {
    if (!Number.isInteger(query.page) || query.page < 1 || query.page > MAX_OFFSET_PAGE
      || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw validation("Invalid announcement pagination");
    }
    assertPortableLikeSearch(query.search, "Announcement search");
    return this.store.list({ ...query, readScope: contentReadScopes(context).announcement, now: context.now });
  }

  async get(context: RequestContext, id: string): Promise<Announcement> {
    const row = await this.store.get(id, contentReadScopes(context).announcement, context.now);
    if (!row) throw notFound();
    return withoutRevision(row);
  }

  async recordView(context: RequestContext, id: string): Promise<Readonly<{ view_count: number }>> {
    const viewCount = await this.store.incrementView(id, contentReadScopes(context).announcement, context.now);
    if (viewCount === null) throw notFound();
    return { view_count: viewCount };
  }

  async create(
    context: RequestContext,
    input: CreateAnnouncementInput,
    requestOrigin: string,
    imageQuota: number,
    attachmentQuota: number,
  ): Promise<Announcement> {
    const actor = context.authorization.require(PERMISSION_ID.ANNOUNCEMENTS_CREATE);
    const bodyJson = canonicalizeRichTextMedia(input.body_json, requestOrigin);
    const mediaIds = extractRichTextMediaIds(bodyJson);
    const state = normalizeState(input.status, input.publish_at ?? null, context.now, true);
    const record: AnnouncementRecord = {
      id: nanoid(),
      title: input.title.trim(),
      body_json: bodyJson,
      category: input.category,
      pinned: input.pinned,
      view_count: 0,
      status: state.status,
      publish_at: state.publishAt,
      expires_at: null,
      archived_at: null,
      created_by: actor.userId,
      updated_by: null,
      created_at: context.now,
      updated_at: context.now,
      revisionToken: crypto.randomUUID(),
    };
    const audit = createAuditEvent(context, {
      subjectType: "announcement",
      subjectId: record.id,
      subjectLabel: record.title,
      action: "create",
      context: [
        { field: "status", value: { type: "code", value: record.status } },
        { field: "category", value: { type: "code", value: record.category } },
        { field: "pinned", value: { type: "boolean", value: record.pinned } },
        { field: "publish_at", value: record.publish_at === null
          ? { type: "null", value: null }
          : { type: "datetime", value: record.publish_at } },
        ...(input.attachment_media_ids && input.attachment_media_ids.length > 0
          ? [{ field: "media_count" as const, value: { type: "number" as const, value: input.attachment_media_ids.length } }]
          : []),
      ],
    });
    const created = await this.store.create({
      record,
      mediaIds,
      attachmentMediaIds: input.attachment_media_ids ?? [],
      maxItems: imageQuota,
      maxAttachmentItems: attachmentQuota,
      audit,
    });
    if (isMemberVisible(record)) this.publishChange(record, "announcement_created");
    if (record.status === "published") this.publishAnnouncement(record);
    return withoutRevision(created);
  }

  async update(
    context: RequestContext,
    id: string,
    input: UpdateAnnouncementInput,
    requestOrigin: string,
    imageQuota: number,
    attachmentQuota: number,
    ifMatch: string,
  ): Promise<Announcement> {
    const actor = context.authorization.require(PERMISSION_ID.ANNOUNCEMENTS_EDIT);
    const existing = await this.store.get(id, { kind: "all" }, context.now);
    if (!existing) throw notFound();
    if (ifMatch !== announcementEtag(existing)) throw conflict();

    const bodyJson = input.body_json === undefined
      ? existing.body_json
      : canonicalizeRichTextMedia(input.body_json, requestOrigin);
    const state = normalizeState(
      input.status ?? existing.status,
      input.publish_at === undefined ? existing.publish_at : input.publish_at,
      context.now,
      false,
    );
    const updatedAt = monotonicTimestamp(context.now, existing.updated_at);
    const record: AnnouncementRecord = {
      ...toRecord(existing),
      title: input.title?.trim() ?? existing.title,
      body_json: bodyJson,
      category: input.category ?? existing.category,
      pinned: input.pinned ?? existing.pinned,
      status: state.status,
      publish_at: state.publishAt,
      archived_at: null,
      updated_by: actor.userId,
      updated_at: updatedAt,
      revisionToken: crypto.randomUUID(),
    };
    const attachmentsChanged = input.attachment_media_ids !== undefined
      && !sameAttachmentIds(existing.attachments, input.attachment_media_ids);
    const changedSections = [
      ...(existing.body_json === record.body_json ? [] : ["body_json"]),
      ...(attachmentsChanged ? ["attachments"] : []),
    ] as const;
    const audit = createAuditEvent(context, {
      subjectType: "announcement",
      subjectId: id,
      subjectLabel: record.title,
      action: "update",
      changes: [
        ...announcementChanges(existing, record),
        ...(attachmentsChanged ? [{
          field: "media_count" as const,
          before: { type: "number" as const, value: existing.attachments.length },
          after: { type: "number" as const, value: input.attachment_media_ids!.length },
        }] : []),
      ],
      context: [
        ...(changedSections.length > 0 ? [{
          field: "changed_sections" as const,
          value: { type: "list" as const, value: changedSections.map((value) => ({ type: "code" as const, value })) },
        }] : []),
        ...(attachmentsChanged ? [{
          field: "media_count" as const,
          value: { type: "number" as const, value: input.attachment_media_ids!.length },
        }] : []),
      ],
    });
    const updated = await this.store.update({
      record,
      expectedRevisionToken: existing.revisionToken,
      mediaIds: input.body_json === undefined ? null : extractRichTextMediaIds(bodyJson),
      attachmentMediaIds: input.attachment_media_ids ?? null,
      maxItems: imageQuota,
      maxAttachmentItems: attachmentQuota,
      audit,
    });
    if (!updated) throw conflict();
    // A formerly public announcement still needs an invalidation when an editor
    // moves it back to a private state. Purely private draft activity does not.
    if (isMemberVisible(existing) || isMemberVisible(record)) {
      this.publishChange(record, "announcement_updated");
    }
    if (existing.status !== "published" && record.status === "published") this.publishAnnouncement(record);
    return withoutRevision(updated);
  }

  async archive(context: RequestContext, id: string, ifMatch: string): Promise<Readonly<{ ok: true }>> {
    const actor = context.authorization.require(PERMISSION_ID.ANNOUNCEMENTS_ARCHIVE);
    const existing = await this.store.get(id, { kind: "all" }, context.now);
    if (!existing) throw notFound();
    if (ifMatch !== announcementEtag(existing)) throw conflict();
    const updatedAt = monotonicTimestamp(context.now, existing.updated_at);
    const audit = createAuditEvent(context, {
      subjectType: "announcement",
      subjectId: id,
      subjectLabel: existing.title,
      action: "archive",
      changes: [{
        field: "archived",
        before: { type: "boolean", value: false },
        after: { type: "boolean", value: true },
      }],
    });
    const changed = await this.store.archive({
      id,
      expectedRevisionToken: existing.revisionToken,
      revisionToken: crypto.randomUUID(),
      updatedAt,
      actorUserId: actor.userId,
      audit,
    });
    if (!changed) throw conflict();
    if (isMemberVisible(existing)) {
      this.publishChange({ id: existing.id, updated_at: updatedAt }, "announcement_archived");
    }
    return { ok: true };
  }

  async delete(context: RequestContext, id: string, ifMatch: string): Promise<Readonly<{ ok: true }>> {
    context.authorization.require(PERMISSION_ID.ANNOUNCEMENTS_DELETE);
    const existing = await this.store.get(id, { kind: "all" }, context.now);
    if (!existing) throw notFound();
    if (ifMatch !== announcementEtag(existing)) throw conflict();
    const audit = createAuditEvent(context, {
      subjectType: "announcement",
      subjectId: id,
      subjectLabel: existing.title,
      action: "delete",
      context: [
        { field: "status", value: { type: "code", value: existing.status } },
        { field: "category", value: { type: "code", value: existing.category } },
        { field: "pinned", value: { type: "boolean", value: existing.pinned } },
        { field: "publish_at", value: existing.publish_at === null
          ? { type: "null", value: null }
          : { type: "datetime", value: existing.publish_at } },
      ],
    });
    const changed = await this.store.delete({
      id,
      expectedRevisionToken: existing.revisionToken,
      mutationToken: crypto.randomUUID(),
      audit,
    });
    if (!changed) throw conflict();
    if (isMemberVisible(existing)) this.publishChange(existing, "announcement_deleted");
    return { ok: true };
  }

  async uploadPendingImages(
    context: RequestContext,
    uploads: readonly ImageUpload[],
    maxBytes: number,
    quota: number,
  ): Promise<Readonly<{ expires_at: string; media_ids: readonly string[] }>> {
    context.authorization.requireAuthenticated();
    if (
      !context.authorization.has(PERMISSION_ID.ANNOUNCEMENTS_CREATE)
      && !context.authorization.has(PERMISSION_ID.ANNOUNCEMENTS_EDIT)
    ) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Permission denied" });
    }
    if (uploads.length > quota) throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: `Announcement image quota is ${quota}` });
    const mediaIds = await this.media.uploadImages(context, "announcement_image", uploads, maxBytes);
    return {
      expires_at: new Date(Date.parse(context.now) + 24 * 60 * 60 * 1_000).toISOString(),
      media_ids: mediaIds,
    };
  }

  async uploadPendingAttachment(
    context: RequestContext,
    upload: FileUpload,
    maxBytes: number,
    quota: number,
  ): Promise<Readonly<{ expires_at: string; attachment: AnnouncementAttachment }>> {
    context.authorization.requireAuthenticated();
    if (
      !context.authorization.has(PERMISSION_ID.ANNOUNCEMENTS_CREATE)
      && !context.authorization.has(PERMISSION_ID.ANNOUNCEMENTS_EDIT)
    ) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Permission denied" });
    }
    if (!Number.isInteger(quota) || quota < 1) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Announcement attachment quota is unavailable" });
    }
    const attachment = await this.media.uploadAnnouncementAttachment(context, upload, maxBytes);
    return {
      expires_at: new Date(Date.parse(context.now) + 24 * 60 * 60 * 1_000).toISOString(),
      attachment,
    };
  }

  private publishChange(record: Pick<Announcement, "id" | "updated_at">, hint: string): void {
    this.deferred.defer(() => this.notifications.publish({
      type: "entity_changed",
      entity_type: "announcement",
      entity_id: record.id,
      updated_at: record.updated_at,
      hint,
    }));
  }

  private publishAnnouncement(record: Pick<Announcement, "id" | "updated_at">): void {
    this.publishChange(record, "announcement_published");
    this.deferred.defer(() => this.notifications.publish({ type: "inbox_changed" }));
  }

}

function isMemberVisible(record: Pick<Announcement, "status">): boolean {
  return record.status === "published";
}

function normalizeState(
  status: AnnouncementStatus,
  publishAtInput: string | null,
  now: string,
  creating: boolean,
): Readonly<{ status: AnnouncementStatus; publishAt: string | null }> {
  if (status === "archived") {
    if (creating) throw validation("Announcements cannot be created as archived");
    throw validation("Use the archive action to archive an announcement");
  }
  const publishAt = status === "published" ? publishAtInput ?? now : publishAtInput;
  if (status === "published" && publishAt! > now) {
    throw validation("Future announcements must use scheduled status");
  }
  if (status === "scheduled" && (!publishAt || publishAt <= now)) {
    throw validation("Scheduled publish time must be in the future");
  }
  return { status, publishAt };
}

function announcementChanges(before: Announcement, after: AnnouncementRecord): AuditChange[] {
  const changes: AuditChange[] = [];
  if (before.title !== after.title) changes.push({
    field: "title", before: { type: "text", value: before.title }, after: { type: "text", value: after.title },
  });
  if (before.pinned !== after.pinned) changes.push({
    field: "pinned", before: { type: "boolean", value: before.pinned }, after: { type: "boolean", value: after.pinned },
  });
  if (before.category !== after.category) changes.push({
    field: "category", before: { type: "code", value: before.category }, after: { type: "code", value: after.category },
  });
  if (before.status !== after.status) changes.push({
    field: "status", before: { type: "code", value: before.status }, after: { type: "code", value: after.status },
  });
  if (before.publish_at !== after.publish_at) changes.push({
    field: "publish_at",
    before: before.publish_at === null ? { type: "null", value: null } : { type: "datetime", value: before.publish_at },
    after: after.publish_at === null ? { type: "null", value: null } : { type: "datetime", value: after.publish_at },
  });
  return changes;
}

function withoutRevision(record: AnnouncementDetailRecord): Announcement {
  const { revisionToken: _revisionToken, ...announcement } = record;
  return announcement;
}

function toRecord(record: AnnouncementDetailRecord): AnnouncementRecord {
  const {
    author: _author,
    attachments: _attachments,
    excerpt: _excerpt,
    preview_media_id: _previewMediaId,
    ...announcement
  } = record;
  return announcement;
}

function sameAttachmentIds(
  existing: readonly AnnouncementAttachment[],
  next: readonly string[],
): boolean {
  return existing.length === next.length && existing.every((attachment, index) => attachment.media_id === next[index]);
}

function monotonicTimestamp(now: string, previous: string): string {
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}

function notFound(): AppError {
  return new AppError({ code: "NOT_FOUND", status: 404, message: "Announcement not found" });
}

function conflict(): AppError {
  return new AppError({ code: "CONFLICT", status: 409, message: "Announcement has been modified by another user" });
}
