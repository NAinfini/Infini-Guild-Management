import {
  announcementSchema,
} from "@guild/shared";
import type { WriteAuditLogInput as AuditLogInput } from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { announcements } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, likeEscaped } from "./helpers";
import { buildReplaceMediaRefsStatements, extractAnnouncementImageNodeKeys } from "./media-references";
import { rethrowAfterUploadFailure } from "./media-upload-compensation";
import { ANNOUNCEMENT_IMAGE_LEASE_TTL_SECONDS, verifyAnnouncementImageStagingToken } from "./announcement-image-staging";
import { buildAnnouncementImageKey } from "./media-keys";

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
  media: R2Bucket;
  rawDb: D1Database;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
  publishAnnouncementPublished: (input: AnnouncementPublishedInput) => Promise<void>;
  signingSecret: string;
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
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
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

  private async classifyMediaKeys(
    actorId: string,
    announcementId: string,
    keys: readonly string[],
    nowIso: string,
  ): Promise<{ valid: boolean; leasedKeys: string[] }> {
    const leasedKeys: string[] = [];
    for (const key of keys) {
      const access = await this.deps.rawDb.prepare(`
        SELECT
          EXISTS(
            SELECT 1 FROM media_references
            WHERE media_key = ?1 AND entity_type = 'announcement' AND entity_id = ?2
          ) AS referenced,
          EXISTS(
            SELECT 1 FROM media_upload_leases
            WHERE media_key = ?1
              AND owner_user_id = ?3
              AND entity_type = 'announcement'
              AND entity_id = ?2
              AND expires_at > ?4
          ) AS leased
      `).bind(key, announcementId, actorId, nowIso).first<{ referenced: number; leased: number }>();
      if (!access || (!access.referenced && !access.leased)) return { valid: false, leasedKeys: [] };
      if (access.leased) leasedKeys.push(key);
    }
    return { valid: true, leasedKeys };
  }

  private buildLeaseConsumptionStatements(
    actorId: string,
    announcementId: string,
    keys: readonly string[],
    nowIso: string,
    committedAt: string,
  ) {
    return keys.map((key) => this.deps.rawDb.prepare(`
      DELETE FROM media_upload_leases
      WHERE media_key = ?1
        AND owner_user_id = ?2
        AND entity_type = 'announcement'
        AND entity_id = ?3
        AND expires_at > ?4
        AND EXISTS (
          SELECT 1 FROM announcements
          WHERE id = ?3 AND updated_at = ?5
        )
    `).bind(key, actorId, announcementId, nowIso, committedAt));
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

  async create(actorId: string, data: { title: string; body_json: string; pinned: boolean; status: AnnouncementStatus; publish_at?: string | null; expires_at?: string | null; staging_token?: string }): Promise<ServiceResult<unknown>> {
    if (data.publish_at && data.expires_at) {
      const publishDate = new Date(data.publish_at);
      const expiryDate = new Date(data.expires_at);
      if (!Number.isNaN(publishDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate <= publishDate) {
        return err("VALIDATION_ERROR", "expires_at must be after publish_at");
      }
    }
    const nowIso = new Date().toISOString();
    const stagingPayload = data.staging_token
      ? await verifyAnnouncementImageStagingToken(this.deps.signingSecret, data.staging_token, actorId)
      : null;
    if (data.staging_token && !stagingPayload) return err("FORBIDDEN", "Invalid, expired, or unauthorized staging token");
    const announcementId = stagingPayload?.announcement_id ?? nanoid();
    if (stagingPayload && await this.getById(announcementId)) return err("CONFLICT", "Announcement already exists");
    const claimedKeys = extractAnnouncementImageNodeKeys(data.body_json, announcementId);
    let leasedKeys: string[] = [];
    if (stagingPayload) {
      for (const key of claimedKeys) {
        if (!await this.deps.media.head(key)) {
          return err("VALIDATION_ERROR", "Staged announcement image not found");
        }
      }
      const access = await this.classifyMediaKeys(actorId, announcementId, claimedKeys, nowIso);
      if (!access.valid) return err("FORBIDDEN", "Staged announcement image is expired or belongs to another user");
      leasedKeys = access.leasedKeys;
    } else if (claimedKeys.length > 0) {
      const access = await this.classifyMediaKeys(actorId, announcementId, claimedKeys, nowIso);
      if (!access.valid) return err("FORBIDDEN", "Announcement image is not available to this user");
      leasedKeys = access.leasedKeys;
    }
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare(
        "INSERT INTO announcements (id, title, body_json, pinned, status, publish_at, expires_at, archived_at, created_by, updated_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, ?9, ?9)",
      ).bind(announcementId, data.title, data.body_json, data.pinned ? 1 : 0, data.status, data.publish_at ?? null, data.expires_at ?? null, actorId, nowIso),
      ...buildReplaceMediaRefsStatements(this.deps.rawDb, "announcement", announcementId, claimedKeys),
      ...this.buildLeaseConsumptionStatements(actorId, announcementId, leasedKeys, nowIso, nowIso),
    ]);

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

    if (data.body_json !== undefined) {
      const assignments: string[] = ["updated_at = ?", "updated_by = ?"];
      const values: Array<string | number | null> = [patch.updatedAt as string, actorId];
      const add = (column: string, value: string | number | null) => {
        assignments.push(`${column} = ?`);
        values.push(value);
      };
      if (data.title !== undefined) add("title", data.title);
      add("body_json", data.body_json);
      if (data.pinned !== undefined) add("pinned", data.pinned ? 1 : 0);
      if (data.status !== undefined) add("status", data.status);
      if (data.publish_at !== undefined) add("publish_at", data.publish_at);
      if (data.expires_at !== undefined) add("expires_at", data.expires_at);
      if (data.archived_at !== undefined) add("archived_at", data.archived_at);
      const where = conditionalEtag ? "id = ? AND updated_at = ?" : "id = ?";
      const updateStatement = this.deps.rawDb
        .prepare(`UPDATE announcements SET ${assignments.join(", ")} WHERE ${where}`)
        .bind(...values, announcementId, ...(conditionalEtag ? [existing.updatedAt] : []));
      const keys = extractAnnouncementImageNodeKeys(data.body_json, announcementId);
      const access = await this.classifyMediaKeys(actorId, announcementId, keys, patch.updatedAt as string);
      if (!access.valid) return err("FORBIDDEN", "Announcement image is expired or belongs to another user");
      const refStatements = conditionalEtag
        ? [
            this.deps.rawDb.prepare(`
              DELETE FROM media_references
              WHERE entity_type = ?1 AND entity_id = ?2
                AND EXISTS (SELECT 1 FROM announcements WHERE id = ?3 AND updated_at = ?4)
            `).bind("announcement", announcementId, announcementId, patch.updatedAt),
            ...keys.map((key) => this.deps.rawDb.prepare(`
              INSERT OR IGNORE INTO media_references (media_key, entity_type, entity_id)
              SELECT ?1, ?2, ?3
              WHERE EXISTS (SELECT 1 FROM announcements WHERE id = ?4 AND updated_at = ?5)
            `).bind(key, "announcement", announcementId, announcementId, patch.updatedAt)),
          ]
        : buildReplaceMediaRefsStatements(this.deps.rawDb, "announcement", announcementId, keys);
      const results = await this.deps.rawDb.batch([
        updateStatement,
        ...refStatements,
        ...this.buildLeaseConsumptionStatements(
          actorId,
          announcementId,
          access.leasedKeys,
          patch.updatedAt as string,
          patch.updatedAt as string,
        ),
      ]);
      if (conditionalEtag && Number(results[0]?.meta?.changes ?? 0) === 0) {
        return err("CONFLICT", "Announcement has been modified by another user");
      }
    } else {
      const updateWhere = conditionalEtag
        ? and(eq(announcements.id, announcementId), eq(announcements.updatedAt, existing.updatedAt))
        : eq(announcements.id, announcementId);
      const updateQuery = this.db.update(announcements).set(patch).where(updateWhere);
      if (conditionalEtag) {
        const updatedRows = await updateQuery.returning({ id: announcements.id });
        if (updatedRows.length === 0) return err("CONFLICT", "Announcement has been modified by another user");
      } else {
        await updateQuery;
      }
    }
    const updated = await this.getById(announcementId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated announcement");

    const announcementDiff = buildAnnouncementDiff(existing, data);
    await this.deps.writeAuditLog({ entityType: "announcement", action: "update", actorId, entityId: announcementId, diffTitle: updated.title, detailText: announcementDiff ? JSON.stringify(announcementDiff) : null });
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
    const mediaKeys = extractAnnouncementImageNodeKeys(existing.bodyJson, announcementId);
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("DELETE FROM media_references WHERE entity_type = ?1 AND entity_id = ?2").bind("announcement", announcementId),
      this.deps.rawDb.prepare("DELETE FROM announcements WHERE id = ?1").bind(announcementId),
    ]);
    if (this.deps.media.delete) {
      await Promise.allSettled(mediaKeys.map((key) => this.deps.media.delete(key)));
    }
    await this.deps.writeAuditLog({ entityType: "announcement", action: "delete", actorId, entityId: announcementId, diffTitle: existing.title });
    await this.deps.publishEntityChanged({ entityType: "announcement", entityId: announcementId, hint: "announcement_deleted" });
    return ok({ ok: true });
  }

  async uploadImages(actorId: string, announcementId: string, files: Array<{ data: ArrayBuffer; contentType: string }>): Promise<ServiceResult<{ keys: string[] }>> {
    const existing = await this.getById(announcementId);
    if (!existing) return err("NOT_FOUND", "Announcement not found");
    const keys: string[] = [];
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ANNOUNCEMENT_IMAGE_LEASE_TTL_SECONDS * 1000).toISOString();
    try {
      for (const file of files) {
        const key = buildAnnouncementImageKey(announcementId, file.contentType);
        keys.push(key);
        await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      }
      if (keys.length > 0) {
        await this.deps.rawDb.batch(keys.map((key) => this.deps.rawDb.prepare(`
          INSERT INTO media_upload_leases
            (media_key, owner_user_id, entity_type, entity_id, expires_at, created_at)
          VALUES (?1, ?2, 'announcement', ?3, ?4, ?5)
        `).bind(key, actorId, announcementId, expiresAt, createdAt.toISOString())));
      }
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.media.delete(key),
        keys,
      );
    }
    await this.deps.writeAuditLog({ entityType: "announcement", action: "upload_images", actorId, entityId: announcementId, diffTitle: existing.title ?? null, detailText: JSON.stringify({ keys }) });
    return ok({ keys });
  }
}
