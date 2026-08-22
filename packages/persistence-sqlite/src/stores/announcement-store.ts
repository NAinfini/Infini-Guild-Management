import { AppError } from "@guild/kernel";
import type {
  AnnouncementListQuery,
  AnnouncementRecord,
  AnnouncementStore,
} from "@guild/server/modules/announcements";
import type { Announcement, PaginatedResponse } from "@guild/shared";
import { extractTipTapText } from "@guild/shared/utils/tiptap-text";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { assertMediaAttachments, replaceMediaLinksStatements } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

const ANNOUNCEMENT_COLUMNS = [
  "id", "title", "body_json", "pinned", "status", "publish_at", "expires_at", "archived_at",
  "created_by", "updated_by", "created_at", "updated_at",
] as const;

export class SqliteAnnouncementStore implements AnnouncementStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: AnnouncementListQuery): Promise<PaginatedResponse<Announcement>> {
    const { where, params } = announcementWhere(query);
    const direction = query.sort === "updated_asc" ? "ASC" : "DESC";
    const listIndex = query.canReadAll ? "idx_announcements_manage" : "idx_announcements_public";
    const results = await this.sql.batch([
      { method: "get", columns: ["total"], sql: `SELECT COUNT(*) AS total FROM announcements ${where}`, params },
      {
        method: "all",
        columns: ANNOUNCEMENT_COLUMNS,
        sql: `${selectAnnouncement(false, false, listIndex)} ${where}
          ORDER BY pinned DESC, updated_at ${direction}, id ${direction}
          LIMIT ? OFFSET ?`,
        params: [...params, query.limit, (query.page - 1) * query.limit],
      },
    ]);
    const total = numberCell(results[0], "Announcement count");
    const data = allRows(results[1]).map((row) => withoutRevision(mapAnnouncement(row)));
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(total / query.limit),
    };
  }

  async get(id: string, canReadAll: boolean, now: string): Promise<AnnouncementRecord | null> {
    const publicSql = canReadAll ? "" : `AND status = 'published' AND publish_at <= ? AND (expires_at IS NULL OR expires_at > ?)`;
    const result = await this.sql.execute({
      method: "get",
      sql: `${selectAnnouncement(true)} WHERE id = ? ${publicSql} LIMIT 1`,
      params: canReadAll ? [id] : [id, now, now],
    });
    const row = oneRow(result);
    return row ? mapAnnouncement(row) : null;
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
    await this.sql.batch([
      insertAnnouncement(input.record),
      insertAnnouncementMediaLinks(input.record, input.mediaIds),
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
    statements.push(
      {
        method: "run",
        sql: `UPDATE media_links SET audience = ?
          WHERE entity_type = 'announcement' AND entity_id = ? AND slot = 'body'
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
          WHERE entity_type = 'announcement' AND entity_id = ? AND slot = 'body'
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
    clauses.push("status = 'published'", "publish_at <= ?", "(expires_at IS NULL OR expires_at > ?)");
    params.push(query.now, query.now);
  } else {
    if (query.status) { clauses.push("status = ?"); params.push(query.status); }
    if (query.pinned !== undefined) { clauses.push("pinned = ?"); params.push(query.pinned ? 1 : 0); }
    if (query.archived !== undefined) clauses.push(query.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL");
  }
  if (query.search) {
    clauses.push("title LIKE ? ESCAPE '\\'");
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
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
      SELECT media.value, 'announcement', ?, 'body', ?, CAST(media.key AS INTEGER)
      FROM json_each(?) AS media
      ORDER BY CAST(media.key AS INTEGER)`,
    params: [record.id, audience(record), JSON.stringify(mediaIds)],
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

function audience(record: Announcement): "public" | "private" {
  return record.status === "published" ? "public" : "private";
}

function selectAnnouncement(includeRevision: boolean, includeBody = true, index?: string): string {
  return `SELECT id, title, ${includeBody ? "body_json" : "'' AS body_json"}, pinned, status, publish_at, expires_at, archived_at,
    created_by, updated_by, created_at, updated_at${includeRevision ? ", revision_token" : ""}
    FROM announcements${index ? ` INDEXED BY ${index}` : ""}`;
}

function mapAnnouncement(row: readonly SqlValue[]): AnnouncementRecord {
  if (row.length !== 12 && row.length !== 13) throw corrupt("Invalid announcement projection");
  const [id, title, bodyJson, pinned, status, publishAt, expiresAt, archivedAt, createdBy, updatedBy, createdAt, updatedAt, revisionToken] = row;
  if (
    typeof id !== "string" || typeof title !== "string" || typeof bodyJson !== "string"
    || (pinned !== 0 && pinned !== 1) || typeof status !== "string"
    || typeof createdBy !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string"
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
    revisionToken: typeof revisionToken === "string" ? revisionToken : "",
  };
}

function withoutRevision(record: AnnouncementRecord): Announcement {
  const { revisionToken: _revisionToken, ...announcement } = record;
  return announcement;
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
