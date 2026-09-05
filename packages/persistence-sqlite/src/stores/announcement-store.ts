import { AppError } from "@guild/kernel";
import type {
  AnnouncementDetailRecord,
  AnnouncementListQuery,
  AnnouncementRecord,
  AnnouncementStore,
} from "@guild/server/modules/announcements";
import type { ContentReadScope } from "@guild/server";
import type { Announcement, AnnouncementAttachment, AnnouncementSummary, PaginatedResponse } from "@guild/shared";
import { createContentExcerpt, extractTipTapText } from "@guild/shared/utils/tiptap-text";
import type { SqlBatchStatement, SqlExecutor, SqlReadBatchStatement, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

const AUTHOR_COLUMNS = ["author_id", "author_display_name", "author_avatar_media_id"] as const;
const ANNOUNCEMENT_SUMMARY_COLUMNS = [
  "id", "title", "category", "pinned", "view_count", "status", "publish_at", "expires_at", "archived_at",
  "created_by", "updated_by", "created_at", "updated_at", "preview_media_id", "search_text", ...AUTHOR_COLUMNS,
] as const;
const ANNOUNCEMENT_DETAIL_COLUMNS = [
  "id", "title", "body_json", "category", "pinned", "view_count", "status", "publish_at", "expires_at", "archived_at",
  "created_by", "updated_by", "created_at", "updated_at", "preview_media_id", "search_text", ...AUTHOR_COLUMNS, "revision_token",
] as const;

export class SqliteAnnouncementStore implements AnnouncementStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: AnnouncementListQuery): Promise<PaginatedResponse<AnnouncementSummary>> {
    const { where, params } = announcementWhere(query);
    const direction = query.sort === "updated_asc" ? "ASC" : "DESC";
    const listIndex = query.category
      ? query.readScope.kind === "public"
        ? "idx_announcements_category_public"
        : "idx_announcements_category_manage"
      : query.readScope.kind === "all" ? "idx_announcements_manage" : "idx_announcements_public";
    const order = `announcements.pinned DESC, announcements.updated_at ${direction}, announcements.id ${direction}`;
    const results = await this.sql.readBatch([
      { method: "get", columns: ["total"], sql: `SELECT COUNT(*) AS total FROM announcements ${where}`, params },
      {
        method: "all",
        columns: ANNOUNCEMENT_SUMMARY_COLUMNS,
        sql: `${selectAnnouncement("summary", listIndex)} ${where}
          ORDER BY ${order}
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

  async get(id: string, readScope: ContentReadScope, now: string): Promise<AnnouncementDetailRecord | null> {
    return announcementDetailFromResults(await this.sql.readBatch(announcementDetailStatements(id, readScope, now)));
  }

  async incrementView(id: string, readScope: ContentReadScope, now: string): Promise<number | null> {
    const visibility = announcementVisibility(readScope, now, "announcements");
    const row = oneRow(await this.sql.execute({
      method: "get",
      columns: ["view_count"],
      sql: `UPDATE announcements SET view_count = view_count + 1 WHERE id = ? AND ${visibility.sql} RETURNING view_count`,
      params: [id, ...visibility.params],
    }));
    if (!row) return null;
    if (typeof row[0] !== "number") throw corrupt("Invalid announcement view count");
    return row[0];
  }

  async create(input: Parameters<AnnouncementStore["create"]>[0]): Promise<AnnouncementDetailRecord> {
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
    const statements: SqlBatchStatement[] = [
      insertAnnouncement(input.record),
      insertAnnouncementMediaLinks(input.record, input.mediaIds, "body"),
      insertAnnouncementMediaLinks(input.record, input.attachmentMediaIds, "attachment"),
      auditInsertStatement(input.audit),
    ];
    const snapshotOffset = statements.length;
    statements.push(...announcementDetailStatements(
      input.record.id,
      { kind: "all" },
      input.record.updated_at,
      input.record.revisionToken,
    ));
    const created = announcementDetailFromResults((await this.sql.batch(statements)).slice(snapshotOffset));
    if (!created) throw corrupt("Created announcement snapshot is missing");
    return created;
  }

  async update(input: Parameters<AnnouncementStore["update"]>[0]): Promise<AnnouncementDetailRecord | null> {
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
    const snapshotOffset = statements.length;
    statements.push(...announcementDetailStatements(
      input.record.id,
      { kind: "all" },
      input.record.updated_at,
      input.record.revisionToken,
    ));
    const results = await this.sql.batch(statements);
    if (returnedRowCount(results[0]) !== 1) return null;
    const updated = announcementDetailFromResults(results.slice(snapshotOffset));
    if (!updated) throw corrupt("Updated announcement snapshot is missing");
    return updated;
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

}

function announcementWhere(query: AnnouncementListQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const visibility = announcementVisibility(query.readScope, query.now, "announcements");
  clauses.push(visibility.sql);
  params.push(...visibility.params);
  if (query.readScope.kind !== "public") {
    if (query.status) { clauses.push("announcements.status = ?"); params.push(query.status); }
  }
  if (query.category) { clauses.push("announcements.category = ?"); params.push(query.category); }
  if (query.pinned !== undefined) { clauses.push("announcements.pinned = ?"); params.push(query.pinned ? 1 : 0); }
  if (query.search) {
    clauses.push("announcements.title LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(query.search)}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function announcementVisibility(
  readScope: ContentReadScope,
  now: string,
  table: string,
): Readonly<{ sql: string; params: SqlValue[] }> {
  if (readScope.kind === "all") return { sql: "1", params: [] };
  const publicSql = `${table}.status = 'published' AND ${table}.publish_at <= ? AND (${table}.expires_at IS NULL OR ${table}.expires_at > ?)`;
  if (readScope.kind === "owned") {
    return {
      sql: `((${publicSql}) OR ${table}.created_by = ?)`,
      params: [now, now, readScope.ownerUserId],
    };
  }
  return { sql: publicSql, params: [now, now] };
}

function announcementAttachmentVisibility(
  readScope: ContentReadScope,
): Readonly<{ sql: string; params: SqlValue[] }> {
  if (readScope.kind === "all") return { sql: "1", params: [] };
  if (readScope.kind === "owned") {
    return {
      sql: `(links.audience = 'public' OR EXISTS (
        SELECT 1 FROM announcements AS parent
        WHERE parent.id = links.entity_id AND parent.created_by = ?
      ))`,
      params: [readScope.ownerUserId],
    };
  }
  return { sql: "links.audience = 'public'", params: [] };
}

function announcementDetailStatements(
  id: string,
  readScope: ContentReadScope,
  now: string,
  revisionToken?: string,
): SqlReadBatchStatement[] {
  const visibility = announcementVisibility(readScope, now, "announcements");
  const attachmentVisibility = announcementAttachmentVisibility(readScope);
  return [
    {
      method: "get",
      columns: ANNOUNCEMENT_DETAIL_COLUMNS,
      sql: `${selectAnnouncement("detail")} WHERE announcements.id = ? AND ${visibility.sql}${revisionToken === undefined ? "" : " AND announcements.revision_token = ?"} LIMIT 1`,
      params: [id, ...visibility.params, ...(revisionToken === undefined ? [] : [revisionToken])],
    },
    {
      method: "all",
      columns: ["media_id", "original_name", "content_type", "byte_size", "media_type"],
      sql: `SELECT links.media_id, assets.original_name, variants.content_type, variants.byte_size, assets.media_type
        FROM media_links AS links
        JOIN media_assets AS assets ON assets.id = links.media_id
        JOIN media_variants AS variants ON variants.media_id = links.media_id AND variants.variant = 'full'
        WHERE links.entity_type = 'announcement' AND links.entity_id = ? AND links.slot = 'attachment'
          AND ${attachmentVisibility.sql}
        ORDER BY links.sort_order, links.media_id`,
      params: [id, ...attachmentVisibility.params],
    },
  ];
}

function announcementDetailFromResults(results: readonly SqlResult[]): AnnouncementDetailRecord | null {
  const [detailResult, attachmentResult] = results;
  if (!detailResult || !attachmentResult) throw corrupt("Missing announcement detail query result");
  const row = oneRow(detailResult);
  const attachmentRows = allRows(attachmentResult).map(mapAttachment);
  return row ? { ...mapDetail(row), attachments: attachmentRows } : null;
}

// search_text 由正文在每次写入时派生，是搜索投影的规范来源；迁移回填仅是近似。
function insertAnnouncement(record: AnnouncementRecord): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO announcements (
      id, title, body_json, pinned, status, publish_at, expires_at, archived_at,
      created_by, updated_by, revision_token, created_at, updated_at, search_text, category, view_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id, record.title, record.body_json, record.pinned ? 1 : 0, record.status,
      record.publish_at, record.expires_at, record.archived_at, record.created_by,
      record.updated_by, record.revisionToken, record.created_at, record.updated_at,
      extractTipTapText(record.body_json), record.category, record.view_count,
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
      title = ?, body_json = ?, category = ?, pinned = ?, status = ?, publish_at = ?, expires_at = ?,
      archived_at = ?, updated_by = ?, revision_token = ?, updated_at = ?, search_text = ?
      WHERE id = ? AND revision_token = ?
      RETURNING id`,
    params: [
      record.title, record.body_json, record.category, record.pinned ? 1 : 0, record.status, record.publish_at,
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
    announcements.category, announcements.pinned, announcements.view_count, announcements.status,
    announcements.publish_at, announcements.expires_at, announcements.archived_at,
    announcements.created_by, announcements.updated_by, announcements.created_at, announcements.updated_at,
    (
      SELECT previews.media_id FROM media_links AS previews
      WHERE previews.entity_type = 'announcement' AND previews.entity_id = announcements.id
        AND previews.slot = 'body'
      ORDER BY previews.sort_order, previews.media_id
      LIMIT 1
    ) AS preview_media_id,
    announcements.search_text,
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
  if (row.length !== 18) throw corrupt("Invalid announcement summary projection");
  const [
    id,
    title,
    category,
    pinned,
    viewCount,
    status,
    publishAt,
    expiresAt,
    archivedAt,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt,
    previewMediaId,
    searchText,
    authorId,
    authorDisplayName,
    authorAvatarMediaId,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof category !== "string"
    || (pinned !== 0 && pinned !== 1) || typeof viewCount !== "number" || typeof status !== "string"
    || typeof createdBy !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || typeof authorId !== "string" || typeof authorDisplayName !== "string"
    || typeof searchText !== "string"
    || (authorAvatarMediaId !== null && typeof authorAvatarMediaId !== "string")
    || (previewMediaId !== null && typeof previewMediaId !== "string")
  ) throw corrupt("Invalid announcement row");
  return {
    id,
    title,
    category: category as Announcement["category"],
    pinned: pinned === 1,
    view_count: viewCount,
    status: status as Announcement["status"],
    publish_at: nullableString(publishAt),
    expires_at: nullableString(expiresAt),
    archived_at: nullableString(archivedAt),
    created_by: createdBy,
    updated_by: nullableString(updatedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    preview_media_id: previewMediaId,
    excerpt: createContentExcerpt(searchText),
    author: {
      id: authorId,
      display_name: authorDisplayName,
      avatar_media_id: authorAvatarMediaId,
    },
  };
}

function mapDetail(row: readonly SqlValue[]): Omit<Announcement, "attachments"> & Readonly<{ revisionToken: string }> {
  if (row.length !== 20) throw corrupt("Invalid announcement detail projection");
  const [
    id,
    title,
    bodyJson,
    category,
    pinned,
    viewCount,
    status,
    publishAt,
    expiresAt,
    archivedAt,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt,
    previewMediaId,
    searchText,
    authorId,
    authorDisplayName,
    authorAvatarMediaId,
    revisionToken,
  ] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string" || typeof category !== "string"
    || (pinned !== 0 && pinned !== 1) || typeof viewCount !== "number" || typeof status !== "string"
    || typeof createdBy !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || typeof authorId !== "string" || typeof authorDisplayName !== "string"
    || typeof searchText !== "string"
    || (authorAvatarMediaId !== null && typeof authorAvatarMediaId !== "string")
    || (previewMediaId !== null && typeof previewMediaId !== "string")
    || typeof revisionToken !== "string"
  ) throw corrupt("Invalid announcement row");
  return {
    id,
    title,
    body_json: bodyJson,
    category: category as Announcement["category"],
    pinned: pinned === 1,
    view_count: viewCount,
    status: status as Announcement["status"],
    publish_at: nullableString(publishAt),
    expires_at: nullableString(expiresAt),
    archived_at: nullableString(archivedAt),
    created_by: createdBy,
    updated_by: nullableString(updatedBy),
    created_at: createdAt,
    updated_at: updatedAt,
    preview_media_id: previewMediaId,
    excerpt: createContentExcerpt(searchText),
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
      contentType !== "application/octet-stream"
      && contentType !== "application/pdf"
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
