import { AppError } from "@guild/kernel";
import type {
  AnnouncementDetailRecord,
  AnnouncementListQuery,
  AnnouncementRecord,
  AnnouncementStore,
} from "@guild/server/modules/announcements";
import type { Announcement, AnnouncementAttachment, AnnouncementSummary, PaginatedResponse } from "@guild/shared";
import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

const AUTHOR_COLUMNS = ["author_id", "author_display_name", "author_avatar_media_id"] as const;
const ANNOUNCEMENT_SUMMARY_COLUMNS = [
  "id", "title", "pinned", "status", "publish_at", "expires_at", "archived_at",
  "created_by", "updated_by", "created_at", "updated_at", ...AUTHOR_COLUMNS,
] as const;
const ANNOUNCEMENT_DETAIL_COLUMNS = [
  "id", "title", "body_json", "pinned", "status", "publish_at", "expires_at", "archived_at",
  "created_by", "updated_by", "created_at", "updated_at", ...AUTHOR_COLUMNS, "revision_token",
] as const;

export class SqliteAnnouncementStore implements AnnouncementStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: AnnouncementListQuery): Promise<PaginatedResponse<AnnouncementSummary>> {
    const { where, params } = announcementWhere(query);
    const direction = query.sort === "updated_asc" ? "ASC" : "DESC";
    const listIndex = query.canReadAll ? "idx_announcements_manage" : "idx_announcements_public";
    const results = await this.sql.batch([
      { method: "get", columns: ["total"], sql: `SELECT COUNT(*) AS total FROM announcements ${where}`, params },
      {
        method: "all",
        columns: ANNOUNCEMENT_SUMMARY_COLUMNS,
        sql: `${selectAnnouncement("summary", listIndex)} ${where}
          ORDER BY announcements.pinned DESC, announcements.updated_at ${direction}, announcements.id ${direction}
          LIMIT ? OFFSET ?`,
        params: [...params, query.limit, (query.page - 1) * query.limit],
      },
    ]);
    const total = numberCell(results[0], "Announcement count");
    const data = allRows(results[1]).map(mapSummary);
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(total / query.limit),
    };
  }

  async get(id: string, canReadAll: boolean, now: string): Promise<AnnouncementDetailRecord | null> {
    const publicSql = canReadAll ? "" : `AND announcements.status = 'published' AND announcements.publish_at <= ? AND (announcements.expires_at IS NULL OR announcements.expires_at > ?)`;
    const attachmentAudienceSql = canReadAll ? "" : " AND links.audience = 'public'";
    const results = await this.sql.batch([
      {
        method: "get",
        columns: ANNOUNCEMENT_DETAIL_COLUMNS,
        sql: `${selectAnnouncement("detail")} WHERE announcements.id = ? ${publicSql} LIMIT 1`,
        params: canReadAll ? [id] : [id, now, now],
      },
      {
        method: "all",
        columns: ["media_id", "original_name", "content_type", "byte_size", "media_type"],
        sql: `SELECT links.media_id, assets.original_name, variants.content_type, variants.byte_size, assets.media_type
          FROM media_links AS links
          JOIN media_assets AS assets ON assets.id = links.media_id
          JOIN media_variants AS variants ON variants.media_id = links.media_id AND variants.variant = 'full'
          WHERE links.entity_type = 'announcement' AND links.entity_id = ? AND links.slot = 'attachment'${attachmentAudienceSql}
          ORDER BY links.sort_order, links.media_id`,
        params: [id],
      },
    ]);
    const [detailResult, attachmentResult] = results;
    if (!detailResult || !attachmentResult) throw corrupt("Missing announcement detail query result");
    const row = oneRow(detailResult);
    const attachmentRows = allRows(attachmentResult).map(mapAttachment);
    return row ? { ...mapDetail(row), attachments: attachmentRows } : null;
  }

  async create(input: Parameters<AnnouncementStore["create"]>[0]): Promise<void> {
    await assertMediaAttachments(this.sql, {
      actorUserId: input.audit.actorId,
      entityType: "announcement",
      entityId: input.record.id,
      slot: "body",
      purpose: "announcement_image",
      audience: audience(input.record),
      mediaIds: input.mediaIds,
      maxItems: input.maxItems,
    });
    await assertMediaAttachments(this.sql, {
      actorUserId: input.audit.actorId,
      entityType: "announcement",
      entityId: input.record.id,
      slot: "attachment",
      purpose: "announcement_attachment",
      audience: audience(input.record),
      mediaIds: input.attachmentMediaIds,
      maxItems: input.maxAttachmentItems,
    });
    await this.sql.batch([
      insertAnnouncement(input.record),
      insertAnnouncementMediaLinks(input.record, input.mediaIds, "body"),
      insertAnnouncementMediaLinks(input.record, input.attachmentMediaIds, "attachment"),
      auditInsertStatement(input.audit),
    ]);
  }

  async update(input: Parameters<AnnouncementStore["update"]>[0]): Promise<boolean> {
    if (input.mediaIds) {
      await assertMediaAttachments(this.sql, {
        actorUserId: input.audit.actorId,
        entityType: "announcement",
        entityId: input.record.id,
        slot: "body",
        purpose: "announcement_image",
        audience: audience(input.record),
        mediaIds: input.mediaIds,
        maxItems: input.maxItems,
      });
    }
    if (input.attachmentMediaIds) {
      await assertMediaAttachments(this.sql, {
        actorUserId: input.audit.actorId,
        entityType: "announcement",
        entityId: input.record.id,
        slot: "attachment",
        purpose: "announcement_attachment",
        audience: audience(input.record),
        mediaIds: input.attachmentMediaIds,
        maxItems: input.maxAttachmentItems,
      });
    }
    const guard = revisionGuard(input.record.id, input.record.revisionToken);
    const statements: SqlBatchStatement[] = [updateAnnouncement(input.record, input.expectedRevisionToken)];
    if (input.mediaIds) {
      statements.push(...replaceMediaLinksStatements({
        entityType: "announcement",
        entityId: input.record.id,
        slot: "body",
        audience: audience(input.record),
        mediaIds: input.mediaIds,
      }, guard));
    }
    if (input.attachmentMediaIds) {
      statements.push(...replaceMediaLinksStatements({
        entityType: "announcement",
        entityId: input.record.id,
        slot: "attachment",
        audience: audience(input.record),
        mediaIds: input.attachmentMediaIds,
      }, guard));
    }
    statements.push(
      {
        method: "run",
        sql: `UPDATE media_links SET audience = ?
          WHERE entity_type = 'announcement' AND entity_id = ? AND slot IN ('body', 'attachment')
            AND EXISTS (${guard.sql})`,
        params: [audience(input.record), input.record.id, ...guard.params],
      },
      auditInsertStatement(input.audit, guard),
    );
    const results = await this.sql.batch(statements);
    return returnedRowCount(results[0]) === 1;
  }

  async archive(input: Parameters<AnnouncementStore["archive"]>[0]): Promise<boolean> {
    const guard = revisionGuard(input.id, input.revisionToken);
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["id"],
        sql: `UPDATE announcements
          SET status = 'archived', archived_at = ?, updated_by = ?, updated_at = ?, revision_token = ?
          WHERE id = ? AND revision_token = ?
          RETURNING id`,
        params: [input.updatedAt, input.actorUserId, input.updatedAt, input.revisionToken, input.id, input.expectedRevisionToken],
      },
      {
        method: "run",
        sql: `UPDATE media_links SET audience = 'private'
          WHERE entity_type = 'announcement' AND entity_id = ? AND slot IN ('body', 'attachment')
            AND EXISTS (${guard.sql})`,
        params: [input.id, ...guard.params],
      },
      auditInsertStatement(input.audit, guard),
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async delete(input: Parameters<AnnouncementStore["delete"]>[0]): Promise<boolean> {
    const guard = revisionGuard(input.id, input.mutationToken);
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["id"],
        sql: `UPDATE announcements SET revision_token = ? WHERE id = ? AND revision_token = ? RETURNING id`,
        params: [input.mutationToken, input.id, input.expectedRevisionToken],
      },
      auditInsertStatement(input.audit, guard),
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'announcement' AND entity_id = ?
            AND EXISTS (${guard.sql})`,
        params: [input.id, ...guard.params],
      },
      {
        method: "run",
        sql: `DELETE FROM announcements WHERE id = ? AND revision_token = ?`,
        params: [input.id, input.mutationToken],
      },
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async appendImages(input: Parameters<AnnouncementStore["appendImages"]>[0]): Promise<boolean> {
    await assertMediaAttachments(this.sql, {
      actorUserId: input.ownerUserId,
      entityType: "announcement",
      entityId: input.id,
      slot: "body",
      purpose: input.purpose,
      audience: input.audience,
      mediaIds: input.mediaIds,
      maxItems: input.maxItems,
    });
    const guard = revisionGuard(input.id, input.revisionToken);
    const statements: SqlBatchStatement[] = [{
      method: "get",
      columns: ["revision_matches", "quota_available"],
      sql: `SELECT
          revision_token = ? AS revision_matches,
          (SELECT COUNT(*) FROM media_links
            WHERE entity_type = 'announcement' AND entity_id = ? AND slot = 'body') + ? <= ? AS quota_available
        FROM announcements WHERE id = ?`,
      params: [input.expectedRevisionToken, input.id, input.mediaIds.length, input.maxItems, input.id],
    }, {
      method: "all",
      columns: ["id"],
      sql: `UPDATE announcements
        SET revision_token = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND revision_token = ?
          AND (SELECT COUNT(*) FROM media_links
            WHERE entity_type = 'announcement' AND entity_id = ? AND slot = 'body') + ? <= ?
        RETURNING id`,
      params: [
        input.revisionToken,
        input.updatedAt,
        input.ownerUserId,
        input.id,
        input.expectedRevisionToken,
        input.id,
        input.mediaIds.length,
        input.maxItems,
      ],
    }];
    statements.push({
      method: "run",
      sql: `WITH next_sort(sort_order) AS (
          SELECT COALESCE(MAX(sort_order) + 1, 0)
          FROM media_links
          WHERE entity_type = 'announcement' AND entity_id = ? AND slot = 'body'
        )
        INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
        SELECT media.value, 'announcement', ?, 'body', ?,
          next_sort.sort_order + CAST(media.key AS INTEGER)
        FROM json_each(?) AS media
        CROSS JOIN next_sort
        WHERE EXISTS (${guard.sql})`,
      params: [input.id, input.id, input.audience, JSON.stringify(input.mediaIds), ...guard.params],
    });
    statements.push(auditInsertStatement(input.audit, guard));
    const results = await this.sql.batch(statements);
    if (!results[0]) throw corrupt("Missing announcement image quota claim");
    const claim = oneRow(results[0]);
    if (!claim || claim[0] !== 1) return false;
    if (claim[1] !== 1) throw validation(`Announcement image quota is ${input.maxItems}`);
    return returnedRowCount(results[1]) === 1;
  }
}

function announcementWhere(query: AnnouncementListQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (!query.canReadAll) {
    clauses.push("announcements.status = 'published'", "announcements.publish_at <= ?", "(announcements.expires_at IS NULL OR announcements.expires_at > ?)");
    params.push(query.now, query.now);
  } else {
    if (query.status) { clauses.push("announcements.status = ?"); params.push(query.status); }
    if (query.pinned !== undefined) { clauses.push("announcements.pinned = ?"); params.push(query.pinned ? 1 : 0); }
    if (query.archived !== undefined) clauses.push(query.archived ? "announcements.archived_at IS NOT NULL" : "announcements.archived_at IS NULL");
  }
  if (query.search) {
    clauses.push("announcements.title LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(query.search)}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// search_text 由正文在每次写入时派生，是搜索投影的规范来源；迁移回填仅是近似。
function insertAnnouncement(record: AnnouncementRecord): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO announcements (
      id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
      created_by, updated_by, revision_token, created_at, updated_at, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id, record.title, record.body_json, record.pinned ? 1 : 0, record.status,
      record.publish_at, record.expires_at, record.archived_at, record.created_by,
      record.updated_by, record.revisionToken, record.created_at, record.updated_at,
      extractTipTapText(record.body_json),
    ],
  };
}

function insertAnnouncementMediaLinks(
  record: AnnouncementRecord,
  mediaIds: readonly string[],
  slot: "body" | "attachment",
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
      SELECT media.value, 'announcement', ?, ?, ?, CAST(media.key AS INTEGER)
      FROM json_each(?) AS media
      ORDER BY CAST(media.key AS INTEGER)`,
    params: [record.id, slot, audience(record), JSON.stringify(mediaIds)],
  };
}

function updateAnnouncement(record: AnnouncementRecord, expectedRevisionToken: string): SqlBatchStatement {
  return {
    method: "all",
    columns: ["id"],
    sql: `UPDATE announcements SET
      title = ?, body_json = ?, pinned = ?, status = ?, publish_at = ?, expires_at = ?,
      archived_at = ?, updated_by = ?, revision_token = ?, updated_at = ?, search_text = ?
      WHERE id = ? AND revision_token = ?
      RETURNING id`,
    params: [
      record.title, record.body_json, record.pinned ? 1 : 0, record.status, record.publish_at,
      record.expires_at, record.archived_at, record.updated_by, record.revisionToken,
      record.updated_at, extractTipTapText(record.body_json), record.id, expectedRevisionToken,
    ],
  };
}

function revisionGuard(id: string, revisionToken: string): Readonly<{ sql: string; params: readonly SqlValue[] }> {
  return { sql: "SELECT 1 FROM announcements WHERE id = ? AND revision_token = ?", params: [id, revisionToken] };
}

function audience(record: Pick<Announcement, "status">): "public" | "private" {
  return record.status === "published" ? "public" : "private";
}

function selectAnnouncement(kind: "summary" | "detail", index?: string): string {
  const detail = kind === "detail";
  return `SELECT announcements.id, announcements.title${detail ? ", announcements.body_json" : ""},
    announcements.pinned, announcements.status, announcements.publish_at, announcements.expires_at, announcements.archived_at,
    announcements.created_by, announcements.updated_by, announcements.created_at, announcements.updated_at,
    authors.id AS author_id, authors.display_name AS author_display_name,
    (
      SELECT avatars.media_id FROM media_links AS avatars
      WHERE avatars.entity_type = 'member_profile' AND avatars.entity_id = announcements.created_by
        AND avatars.slot = 'avatar' AND avatars.audience = 'public'
      ORDER BY avatars.sort_order, avatars.media_id
      LIMIT 1
    ) AS author_avatar_media_id${detail ? ", announcements.revision_token" : ""}
    FROM announcements${index ? ` INDEXED BY ${index}` : ""}
    JOIN users AS authors ON authors.id = announcements.created_by`;
}

function mapSummary(row: readonly SqlValue[]): AnnouncementSummary {
  if (row.length !== 14) throw corrupt("Invalid announcement summary projection");
  const [
    id,
    title,
    pinned,
    status,
    publishAt,
    expiresAt,
    archivedAt,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt,
    authorId,
    authorDisplayName,
    authorAvatarMediaId,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string"
    || (pinned !== 0 && pinned !== 1) || typeof status !== "string"
    || typeof createdBy !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || typeof authorId !== "string" || typeof authorDisplayName !== "string"
    || (authorAvatarMediaId !== null && typeof authorAvatarMediaId !== "string")
  ) throw corrupt("Invalid announcement row");
  return {
    id,
    title,
    pinned: pinned === 1,
    status: status as Announcement["status"],
    publish_at: nullableString(publishAt),
    expires_at: nullableString(expiresAt),
    archived_at: nullableString(archivedAt),
    created_by: createdBy,
    updated_by: nullableString(updatedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    author: {
      id: authorId,
      display_name: authorDisplayName,
      avatar_media_id: authorAvatarMediaId,
    },
  };
}

function mapDetail(row: readonly SqlValue[]): Omit<Announcement, "attachments"> & Readonly<{ revisionToken: string }> {
  if (row.length !== 16) throw corrupt("Invalid announcement detail projection");
  const [
    id,
    title,
    bodyJson,
    pinned,
    status,
    publishAt,
    expiresAt,
    archivedAt,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt,
    authorId,
    authorDisplayName,
    authorAvatarMediaId,
    revisionToken,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string"
    || (pinned !== 0 && pinned !== 1) || typeof status !== "string"
    || typeof createdBy !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || typeof authorId !== "string" || typeof authorDisplayName !== "string"
    || (authorAvatarMediaId !== null && typeof authorAvatarMediaId !== "string")
    || typeof revisionToken !== "string"
  ) throw corrupt("Invalid announcement row");
  return {
    id,
    title,
    body_json: bodyJson,
    pinned: pinned === 1,
    status: status as Announcement["status"],
    publish_at: nullableString(publishAt),
    expires_at: nullableString(expiresAt),
    archived_at: nullableString(archivedAt),
    created_by: createdBy,
    updated_by: nullableString(updatedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    author: {
      id: authorId,
      display_name: authorDisplayName,
      avatar_media_id: authorAvatarMediaId,
    },
    revisionToken,
  };
}

function mapAttachment(row: readonly SqlValue[]): AnnouncementAttachment {
  const [mediaId, originalName, contentType, byteSize, mediaType] = row;
  if (
    typeof mediaId !== "string"
    || typeof originalName !== "string"
    || typeof byteSize !== "number"
    || !Number.isSafeInteger(byteSize)
    || byteSize < 1
    || mediaType !== "file"
    || (
      contentType !== "application/pdf"
      && contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  ) throw corrupt("Invalid announcement attachment projection");
  return { media_id: mediaId, name: originalName, content_type: contentType, byte_size: byteSize };
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) throw corrupt("Invalid SQLite get result");
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult | undefined): readonly (readonly SqlValue[])[] {
  if (!result || result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) throw corrupt("Invalid SQLite all result");
  return result.rows as readonly (readonly SqlValue[])[];
}

function numberCell(result: SqlResult | undefined, label: string): number {
  if (!result) throw corrupt(`${label} is missing`);
  const row = oneRow(result);
  const value = row?.[0];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw corrupt(`${label} is invalid`);
  return value;
}

function nullableString(value: SqlValue | undefined): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw corrupt("Invalid nullable string");
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}

function validation(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
