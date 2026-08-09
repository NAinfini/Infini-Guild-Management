import {
  announcementSchema,
  type JsonValue,
} from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { announcements } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, likeEscaped } from "./helpers";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { extractRichTextMediaIds, MediaValidationError } from "./MediaService";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
type AnnouncementPublishedInput = { announcementId: string; title: string; publishedAt: string };

type AnnouncementStatus = "draft" | "scheduled" | "published" | "archived";
export type AnnouncementSort = "updated_desc" | "updated_asc";

type AnnouncementRow = {
  id: string; title: string; bodyJson: string; pinned: boolean;
  status: AnnouncementStatus; publishAt: string | null; expiresAt: string | null; archivedAt: string | null;
  createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string;
};

export type AnnouncementServiceDeps = {
  mediaService: MediaService;
  rawDb: D1Database;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  publishAnnouncementPublished: (input: AnnouncementPublishedInput) => Promise<void>;
};

// --- Helpers ---

function toPayload(row: AnnouncementRow) {
  return announcementSchema.parse({
    id: row.id, title: row.title, body_json: row.bodyJson, pinned: row.pinned,
    status: row.status, publish_at: row.publishAt, expires_at: row.expiresAt, archived_at: row.archivedAt,
    created_by: row.createdBy, updated_by: row.updatedBy ?? null, created_at: row.createdAt, updated_at: row.updatedAt,
  });
}

const COLS = {
  id: announcements.id, title: announcements.title, bodyJson: announcements.bodyJson,
  pinned: announcements.pinned, status: announcements.status,
  publishAt: announcements.publishAt, expiresAt: announcements.expiresAt, archivedAt: announcements.archivedAt,
  createdBy: announcements.createdBy, updatedBy: announcements.updatedBy, createdAt: announcements.createdAt, updatedAt: announcements.updatedAt,
} as const;

const LIST_COLS = {
  id: announcements.id, title: announcements.title,
  pinned: announcements.pinned, status: announcements.status,
  publishAt: announcements.publishAt, expiresAt: announcements.expiresAt, archivedAt: announcements.archivedAt,
  createdBy: announcements.createdBy, updatedBy: announcements.updatedBy, createdAt: announcements.createdAt, updatedAt: announcements.updatedAt,
} as const;

type AnnouncementListRow = Omit<AnnouncementRow, "bodyJson">;

function toListPayload(row: AnnouncementListRow) {
  return {
    id: row.id, title: row.title, body_json: "", pinned: row.pinned,
    status: row.status, publish_at: row.publishAt, expires_at: row.expiresAt, archived_at: row.archivedAt,
    created_by: row.createdBy, updated_by: row.updatedBy ?? null, created_at: row.createdAt, updated_at: row.updatedAt,
  };
}

function buildAnnouncementDiff(
  existing: AnnouncementRow,
  data: { title?: string; body_json?: string; pinned?: boolean; status?: AnnouncementStatus; publish_at?: string | null; expires_at?: string | null; archived_at?: string | null },
): Record<string, { from: JsonValue; to: JsonValue }> | null {
  const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
  if (data.title !== undefined && data.title !== existing.title) diff.title = { from: existing.title, to: data.title };
  if (data.body_json !== undefined && data.body_json !== existing.bodyJson) diff.body_json = { from: "changed", to: "changed" };
  if (data.pinned !== undefined && data.pinned !== existing.pinned) diff.pinned = { from: existing.pinned, to: data.pinned };
  if (data.status !== undefined && data.status !== existing.status) diff.status = { from: existing.status, to: data.status };
  if (data.publish_at !== undefined && (data.publish_at ?? null) !== existing.publishAt) diff.publish_at = { from: existing.publishAt, to: data.publish_at ?? null };
  if (data.expires_at !== undefined && (data.expires_at ?? null) !== existing.expiresAt) diff.expires_at = { from: existing.expiresAt, to: data.expires_at ?? null };
  if (data.archived_at !== undefined && (data.archived_at ?? null) !== existing.archivedAt) diff.archived_at = { from: existing.archivedAt, to: data.archived_at ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

// --- Service ---

export class AnnouncementService {
  private db: DrizzleDb;
  private deps: AnnouncementServiceDeps;

  constructor(db: DrizzleDb, deps: AnnouncementServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  private async getById(id: string): Promise<AnnouncementRow | null> {
    return (await this.db.select(COLS).from(announcements).where(eq(announcements.id, id)).limit(1))[0] ?? null;
  }

  // --- Public ---

  async list(opts: { canReadAll: boolean; page: number; limit: number; status?: string; pinned?: boolean; archived?: boolean; search?: string; sort?: AnnouncementSort }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (opts.page - 1) * opts.limit;
    const filters: SQL<unknown>[] = [];

    if (opts.status) {
      if (!opts.canReadAll && opts.status !== "published" && opts.status !== "archived") return err("FORBIDDEN", "Moderator role required to read non-public announcements");
      filters.push(eq(announcements.status, opts.status as typeof announcements.status.enumValues[number]));
    } else if (!opts.canReadAll) {
      if (opts.archived === true) { filters.push(eq(announcements.status, "archived")); }
      else if (opts.archived === false) { filters.push(eq(announcements.status, "published")); }
      else { filters.push(inArray(announcements.status, ["published", "archived"])); }
    }
    if (opts.pinned !== undefined) filters.push(eq(announcements.pinned, opts.pinned));
    if (opts.search) {
      const pattern = `%${escapeLikePattern(opts.search)}%`;
      filters.push(or(likeEscaped(announcements.title, pattern), likeEscaped(announcements.bodyJson, pattern))!);
    }

    const whereClause = and(...filters);
    const sortDirection = opts.sort === "updated_asc" ? asc : desc;
    const [rows, countRow] = await Promise.all([
      this.db.select(LIST_COLS).from(announcements).where(whereClause).orderBy(desc(announcements.pinned), sortDirection(announcements.updatedAt), sortDirection(announcements.id)).limit(opts.limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(announcements).where(whereClause),
    ]);
    const total = Number(countRow[0]?.count ?? 0);
    return ok({ data: rows.map(toListPayload), total, page: opts.page, limit: opts.limit, total_pages: Math.max(1, Math.ceil(total / opts.limit)) });
  }

  async getOne(id: string, canReadAll: boolean): Promise<ServiceResult<unknown>> {
    const row = await this.getById(id);
    if (!row) return err("NOT_FOUND", "Announcement not found");
    if (!canReadAll && row.status !== "published" && row.status !== "archived") return err("NOT_FOUND", "Announcement not found");
    return ok(toPayload(row));
  }

  async create(actorId: string, data: { title: string; body_json: string; pinned: boolean; status: AnnouncementStatus; publish_at?: string | null; expires_at?: string | null }): Promise<ServiceResult<unknown>> {
    if (data.publish_at && data.expires_at) {
      const publishDate = new Date(data.publish_at);
      const expiryDate = new Date(data.expires_at);
      if (!Number.isNaN(publishDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate <= publishDate) {
        return err("VALIDATION_ERROR", "expires_at must be after publish_at");
      }
    }
    const nowIso = new Date().toISOString();
    const announcementId = nanoid();
    const mediaIds = extractRichTextMediaIds(data.body_json);
    await this.deps.rawDb.prepare(
      "INSERT INTO announcements (id, title, body_json, pinned, status, publish_at, expires_at, archived_at, created_by, updated_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, ?9, ?9)",
    ).bind(announcementId, data.title, data.body_json, data.pinned ? 1 : 0, data.status, data.publish_at ?? null, data.expires_at ?? null, actorId, nowIso).run();
    try {
      await this.deps.mediaService.replace({
        entityType: "announcement",
        entityId: announcementId,
        slot: "body",
        media: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
        ownerUserId: actorId,
        now: nowIso,
      });
    } catch (error) {
      try {
        await this.deps.rawDb.prepare("DELETE FROM announcements WHERE id = ?1").bind(announcementId).run();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Announcement ${announcementId} attachment and parent cleanup both failed`);
      }
      if (error instanceof MediaValidationError) return err("FORBIDDEN", error.message);
      throw error;
    }

    const created = await this.getById(announcementId);
    if (!created) return err("SERVER_ERROR", "Failed to create announcement");
    await this.deps.writeAuditLog({ entityType: "announcement", action: "create", actorId, entityId: announcementId, diffTitle: created.title });
    await this.deps.publishEntityChanged({ entityType: "announcement", entityId: announcementId, hint: "announcement_created" });
    if (created.status === "published") {
      await this.deps.publishAnnouncementPublished({ announcementId: created.id, title: created.title, publishedAt: created.publishAt ?? created.updatedAt });
    }
    return ok(toPayload(created));
  }

  async update(actorId: string, announcementId: string, data: { title?: string; body_json?: string; pinned?: boolean; status?: AnnouncementStatus; publish_at?: string | null; expires_at?: string | null; archived_at?: string | null }, conditionalEtag?: string): Promise<ServiceResult<unknown>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    if (conditionalEtag) {
      const expectedEtag = `"announcement-${existing.id}-${existing.updatedAt}"`;
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Announcement has been modified by another user");
    }

    const effectivePublishAt = data.publish_at !== undefined ? data.publish_at : existing.publishAt;
    const effectiveExpiresAt = data.expires_at !== undefined ? data.expires_at : existing.expiresAt;
    if (effectivePublishAt && effectiveExpiresAt) {
      const publishDate = new Date(effectivePublishAt);
      const expiryDate = new Date(effectiveExpiresAt);
      if (!Number.isNaN(publishDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate <= publishDate) {
        return err("VALIDATION_ERROR", "expires_at must be after publish_at");
      }
    }

    const patch: Partial<typeof announcements.$inferInsert> = { updatedAt: new Date().toISOString(), updatedBy: actorId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.body_json !== undefined) patch.bodyJson = data.body_json;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.status !== undefined) patch.status = data.status;
    if (data.publish_at !== undefined) patch.publishAt = data.publish_at;
    if (data.expires_at !== undefined) patch.expiresAt = data.expires_at;
    if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;

    const previousMediaIds = data.body_json !== undefined
      ? await this.deps.mediaService.listLinkedMediaIds("announcement", announcementId, "body")
      : [];
    if (data.body_json !== undefined) {
      try {
        const mediaIds = extractRichTextMediaIds(data.body_json);
        await this.deps.mediaService.replace({
          entityType: "announcement",
          entityId: announcementId,
          slot: "body",
          media: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
          ownerUserId: actorId,
          now: patch.updatedAt as string,
        });
      } catch (error) {
        if (error instanceof MediaValidationError) return err("FORBIDDEN", error.message);
        throw error;
      }
    }
    const updateWhere = conditionalEtag
      ? and(eq(announcements.id, announcementId), eq(announcements.updatedAt, existing.updatedAt))
      : eq(announcements.id, announcementId);
    try {
      const updateQuery = this.db.update(announcements).set(patch).where(updateWhere);
      if (conditionalEtag) {
        const updatedRows = await updateQuery.returning({ id: announcements.id });
        if (updatedRows.length === 0) {
          if (data.body_json !== undefined) {
            await this.deps.mediaService.replace({
              entityType: "announcement",
              entityId: announcementId,
              slot: "body",
              media: previousMediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
              now: patch.updatedAt as string,
            });
          }
          return err("CONFLICT", "Announcement has been modified by another user");
        }
      } else {
        await updateQuery;
      }
    } catch (error) {
      if (data.body_json !== undefined) {
        try {
          await this.deps.mediaService.replace({
            entityType: "announcement",
            entityId: announcementId,
            slot: "body",
            media: previousMediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            now: patch.updatedAt as string,
          });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Announcement ${announcementId} update and media rollback both failed`);
        }
      }
      throw error;
    }
    const updated = await this.getById(announcementId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated announcement");

    const announcementDiff = buildAnnouncementDiff(existing, data);
    await this.deps.writeAuditLog({ entityType: "announcement", action: "update", actorId, entityId: announcementId, diffTitle: updated.title, detail: announcementDiff });
    await this.deps.publishEntityChanged({ entityType: "announcement", entityId: announcementId, hint: "announcement_updated" });
    if (existing.status !== "published" && updated.status === "published") {
      await this.deps.publishAnnouncementPublished({ announcementId: updated.id, title: updated.title, publishedAt: updated.publishAt ?? updated.updatedAt });
    }
    return ok(toPayload(updated));
  }

  async archive(actorId: string, announcementId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    const nowIso = new Date().toISOString();
    await this.db.update(announcements).set({ status: "archived", archivedAt: nowIso, updatedAt: nowIso }).where(eq(announcements.id, announcementId));
    await this.deps.writeAuditLog({ entityType: "announcement", action: "archive", actorId, entityId: announcementId, diffTitle: existing.title });
    await this.deps.publishEntityChanged({ entityType: "announcement", entityId: announcementId, hint: "announcement_archived" });
    return ok({ ok: true });
  }

  async permanentDelete(actorId: string, announcementId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    await this.db.delete(announcements).where(eq(announcements.id, announcementId));
    await this.deps.writeAuditLog({ entityType: "announcement", action: "delete", actorId, entityId: announcementId, diffTitle: existing.title });
    await this.deps.publishEntityChanged({ entityType: "announcement", entityId: announcementId, hint: "announcement_deleted" });
    return ok({ ok: true });
  }

  async createPendingImages(
    actorId: string,
    uploads: readonly ParsedImageMediaUpload[],
    quota: number,
    maxBytes: number,
  ): Promise<ServiceResult<{ expires_at: string; media_ids: string[] }>> {
    const now = new Date().toISOString();
    if (!await this.deps.mediaService.checkQuota({ purpose: "announcement_image", ownerUserId: actorId, scope: { kind: "pending" }, limit: quota, incomingCount: uploads.length, now })) {
      return err("VALIDATION_ERROR", `Announcement image quota is ${quota}`);
    }
    try {
      const created = await this.deps.mediaService.createImages({ ownerUserId: actorId, purpose: "announcement_image", uploads, now, maxBytes });
      return ok({ expires_at: created.expiresAt, media_ids: created.mediaIds });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }

  async uploadImages(actorId: string, announcementId: string, uploads: readonly ParsedImageMediaUpload[], quota: number, maxBytes: number): Promise<ServiceResult<{ media_ids: string[] }>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    const now = new Date().toISOString();
    if (!await this.deps.mediaService.checkQuota({ purpose: "announcement_image", ownerUserId: actorId, scope: { kind: "entity", entityType: "announcement", entityId: announcementId }, limit: quota, incomingCount: uploads.length, now })) {
      return err("VALIDATION_ERROR", `Announcement image quota is ${quota}`);
    }
    const current = await this.deps.mediaService.listLinkedMediaIds("announcement", announcementId, "body");
    let createdMediaIds: string[] = [];
    try {
      const created = await this.deps.mediaService.createImages({ ownerUserId: actorId, purpose: "announcement_image", uploads, now, maxBytes });
      createdMediaIds = created.mediaIds;
      await this.deps.mediaService.replace({ entityType: "announcement", entityId: announcementId, slot: "body", media: [...current, ...created.mediaIds].map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now });
      await this.deps.writeAuditLog({ entityType: "announcement", action: "upload_images", actorId, entityId: announcementId, diffTitle: existing.title ?? null, detail: { media_ids: created.mediaIds } });
      return ok({ media_ids: created.mediaIds });
    } catch (error) {
      if (createdMediaIds.length > 0) {
        try {
          await this.deps.mediaService.replace({
            entityType: "announcement",
            entityId: announcementId,
            slot: "body",
            media: current.map((mediaId, sortOrder) => ({ mediaId, sortOrder })),
            now,
          });
          await this.deps.mediaService.deleteAssets(createdMediaIds);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Announcement ${announcementId} image upload and media cleanup both failed`);
        }
      }
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }
}
