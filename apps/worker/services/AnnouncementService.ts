import {
  announcementSchema,
} from "@guild/shared";
import type { AuditEntityType, AuditAction } from "@guild/shared/constants/audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { announcements } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern } from "./helpers";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type AuditLogInput = { entityType: AuditEntityType; action: AuditAction; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };
type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };
type AnnouncementPublishedInput = { announcementId: string; title: string; publishedAt: string };

type AnnouncementStatus = "draft" | "scheduled" | "published" | "archived";

type AnnouncementRow = {
  id: string; title: string; bodyJson: string; pinned: boolean;
  status: AnnouncementStatus; publishAt: string | null; expiresAt: string | null; archivedAt: string | null;
  createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string;
};

export type AnnouncementServiceDeps = {
  media: R2Bucket;
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

  async list(opts: { canReadAll: boolean; page: number; limit: number; status?: string; pinned?: boolean; archived?: boolean; search?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
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
      filters.push(or(like(announcements.title, pattern), like(announcements.bodyJson, pattern))!);
    }

    const whereClause = and(...filters);
    const [rows, countRow] = await Promise.all([
      this.db.select(LIST_COLS).from(announcements).where(whereClause).orderBy(desc(announcements.pinned), desc(announcements.createdAt), desc(announcements.id)).limit(opts.limit).offset(offset),
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
    await this.db.insert(announcements).values({ id: announcementId, title: data.title, bodyJson: data.body_json, pinned: data.pinned, status: data.status, publishAt: data.publish_at ?? null, expiresAt: data.expires_at ?? null, archivedAt: null, createdBy: actorId, updatedAt: nowIso });

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

    await this.db.update(announcements).set(patch).where(eq(announcements.id, announcementId));
    const updated = await this.getById(announcementId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated announcement");

    await this.deps.writeAuditLog({ entityType: "announcement", action: "update", actorId, entityId: announcementId, diffTitle: updated.title, detailText: JSON.stringify(data) });
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

  async uploadImages(actorId: string, announcementId: string, files: Array<{ data: ArrayBuffer; contentType: string }>): Promise<ServiceResult<{ keys: string[] }>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    const keys: string[] = [];
    for (const file of files) {
      const key = `announcement/${announcementId}/images/${Date.now()}_${nanoid()}`;
      await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      keys.push(key);
    }
    await this.deps.writeAuditLog({ entityType: "announcement", action: "upload_images", actorId, entityId: announcementId, diffTitle: existing.title ?? null, detailText: JSON.stringify({ keys }) });
    return ok({ keys });
  }
}
