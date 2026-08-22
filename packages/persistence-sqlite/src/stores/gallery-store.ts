import { AppError } from "@guild/kernel";
import type { GalleryListQuery, GalleryRecord, GalleryStore } from "@guild/server/modules/gallery";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertSelectStatement, auditInsertStatement } from "./audit-statement.js";
import { assertOwnedStagedMedia } from "./media-link-statements.js";
import { returnedRowCount } from "./sql-result.js";

export class SqliteGalleryStore implements GalleryStore {
  constructor(private readonly sql: SqlExecutor) {}

  async list(query: GalleryListQuery): Promise<Readonly<{ data: readonly GalleryRecord[]; hasMore: boolean }>> {
    const { where, params } = galleryWhere(query);
    const direction = query.order === "asc" ? "ASC" : "DESC";
    const result = await this.sql.execute({
      method: "all",
      sql: `${selectGallery()} ${where}
        ORDER BY items.created_at ${direction}, items.id ${direction}
        LIMIT ?`,
      params: [...params, query.limit + 1],
    });
    const rows = allRows(result).map(mapGallery);
    return { data: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
  }

  async get(id: string): Promise<GalleryRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${selectGallery()} WHERE items.id = ? LIMIT 1`,
      params: [id],
    }));
    return row ? mapGallery(row) : null;
  }

  async createImages(input: Parameters<GalleryStore["createImages"]>[0]): Promise<void> {
    if (input.records.length !== input.mediaIds.length || input.records.some((record, index) => record.media_id !== input.mediaIds[index])) {
      throw new TypeError("Gallery image records and media ids must be aligned");
    }
    await assertOwnedStagedMedia(this.sql, {
      ownerUserId: input.ownerUserId,
      purpose: "gallery_image",
      mediaIds: input.mediaIds,
      maxItems: input.maxItems,
    });
    const first = input.records[0];
    if (!first) throw new TypeError("Gallery image batch cannot be empty");
    const claim = {
      sql: `SELECT 1 WHERE
        (SELECT COUNT(*) FROM gallery_items WHERE uploaded_by = ? AND type = 'image') + ? <= ?`,
      params: [input.ownerUserId, input.records.length, input.maxItems],
    } as const;
    const claimed = {
      sql: "SELECT 1 FROM gallery_items WHERE id = ? AND revision_token = ?",
      params: [first.id, first.revisionToken],
    } as const;
    const recordsJson = JSON.stringify(input.records);
    const statements: readonly SqlBatchStatement[] = [{
      method: "all",
      columns: ["affected"],
      sql: `INSERT INTO gallery_items (id, type, url, caption, uploaded_by, revision_token, created_at)
        SELECT
          json_extract(record.value, '$.id'),
          json_extract(record.value, '$.type'),
          json_extract(record.value, '$.url'),
          json_extract(record.value, '$.caption'),
          json_extract(record.value, '$.uploaded_by'),
          json_extract(record.value, '$.revisionToken'),
          json_extract(record.value, '$.created_at')
        FROM json_each(?) AS record
        WHERE EXISTS (${claim.sql})
        ORDER BY CAST(record.key AS INTEGER)
        RETURNING 1 AS affected`,
      params: [recordsJson, ...claim.params],
    }, {
        method: "run",
        sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
          SELECT
            json_extract(record.value, '$.media_id'),
            'gallery_item',
            json_extract(record.value, '$.id'),
            'image',
            'public',
            0
          FROM json_each(?) AS record
          WHERE EXISTS (${claimed.sql})
          ORDER BY CAST(record.key AS INTEGER)`,
        params: [recordsJson, ...claimed.params],
      }, auditInsertStatement(input.audit, claimed)];
    const results = await this.sql.batch(statements);
    if (returnedRowCount(results[0]) !== input.records.length) throw validation(`Gallery image quota is ${input.maxItems}`);
  }

  async createVideo(input: Parameters<GalleryStore["createVideo"]>[0]): Promise<void> {
    await this.sql.batch([insertGallery(input.record), auditInsertStatement(input.audit)]);
  }

  async delete(input: Parameters<GalleryStore["delete"]>[0]): Promise<boolean> {
    const guard = { sql: "SELECT 1 FROM gallery_items WHERE id = ? AND revision_token = ?", params: [input.id, input.mutationToken] } as const;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: "UPDATE gallery_items SET revision_token = ? WHERE id = ? AND revision_token = ? RETURNING 1 AS affected",
        params: [input.mutationToken, input.id, input.expectedRevisionToken],
      },
      auditInsertStatement(input.audit, guard),
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'gallery_item' AND entity_id = ? AND EXISTS (${guard.sql})`,
        params: [input.id, ...guard.params],
      },
      { method: "run", sql: "DELETE FROM gallery_items WHERE id = ? AND revision_token = ?", params: [input.id, input.mutationToken] },
    ]);
    return returnedRowCount(results[0]) === 1;
  }

  async batchDelete(input: Parameters<GalleryStore["batchDelete"]>[0]): Promise<number> {
    const placeholders = input.ids.map(() => "?").join(", ");
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE gallery_items SET revision_token = ? WHERE id IN (${placeholders}) RETURNING 1 AS affected`,
        params: [input.mutationToken, ...input.ids],
      },
      galleryBatchDeleteAuditStatement(input.audit, input.mutationToken),
      {
        method: "run",
        sql: `DELETE FROM media_links
          WHERE entity_type = 'gallery_item'
            AND entity_id IN (SELECT id FROM gallery_items WHERE revision_token = ?)`,
        params: [input.mutationToken],
      },
      { method: "run", sql: "DELETE FROM gallery_items WHERE revision_token = ?", params: [input.mutationToken] },
    ]);
    return returnedRowCount(results[0]);
  }
}

function galleryWhere(query: GalleryListQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (query.type) { clauses.push("items.type = ?"); params.push(query.type); }
  if (query.dateFrom) { clauses.push("items.created_at >= ?"); params.push(query.dateFrom); }
  if (query.dateTo) { clauses.push("items.created_at <= ?"); params.push(query.dateTo); }
  if (query.search) {
    clauses.push("(lower(COALESCE(items.caption, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(users.username, '')) LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    params.push(pattern, pattern);
  }
  if (query.cursor) {
    const operator = query.order === "asc" ? ">" : "<";
    clauses.push(`(items.created_at ${operator} ? OR (items.created_at = ? AND items.id ${operator} ?))`);
    params.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function selectGallery(): string {
  return `SELECT
    items.id, items.type, items.url, items.caption, items.uploaded_by, users.username,
    items.created_at, items.revision_token, links.media_id
    FROM gallery_items AS items
    LEFT JOIN users ON users.id = items.uploaded_by
    LEFT JOIN media_links AS links
      ON links.entity_type = 'gallery_item' AND links.entity_id = items.id AND links.slot = 'image'`;
}

function insertGallery(
  record: GalleryRecord,
  guard?: Readonly<{ sql: string; params: readonly SqlValue[] }>,
): SqlBatchStatement {
  return {
    method: "all",
    columns: ["affected"],
    sql: `INSERT INTO gallery_items (id, type, url, caption, uploaded_by, revision_token, created_at)
      ${guard ? `SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})` : "VALUES (?, ?, ?, ?, ?, ?, ? )"}
      RETURNING 1 AS affected`,
    params: [
      record.id,
      record.type,
      record.url,
      record.caption,
      record.uploaded_by,
      record.revisionToken,
      record.created_at,
      ...(guard?.params ?? []),
    ],
  };
}

function galleryBatchDeleteAuditStatement(
  audit: Parameters<GalleryStore["batchDelete"]>[0]["audit"],
  mutationToken: string,
) {
  return auditInsertSelectStatement(
    `WITH changed AS (
       SELECT id, type, caption FROM gallery_items WHERE revision_token = ?
     )
     SELECT ?, ?, ?, ?,
       CASE WHEN ? = 'user' THEN (SELECT username FROM users WHERE id = ?) ELSE ? END,
       ?, ?, ?, ?,
       json_set(json_set(
         json(?), '$.context[#]',
         json_object(
           'field', 'item_count',
           'value', json_object('type', 'number', 'value', (SELECT count(*) FROM changed))
         )
       ),
         '$.context[#]',
         json_object(
           'field', 'item_ids',
           'value', json_object(
             'type', 'list',
             'value', json((
               SELECT json_group_array(json_object(
                 'type', 'reference',
                 'value', json_object('id', id, 'label', COALESCE(NULLIF(TRIM(caption), ''), type))
               ))
               FROM (SELECT id, type, caption FROM changed ORDER BY id)
             ))
           )
         )
       ), ?
     WHERE EXISTS (SELECT 1 FROM changed)`,
    [
      mutationToken,
      audit.eventId,
      audit.requestId,
      audit.actorKind,
      audit.actorId,
      audit.actorKind,
      audit.actorId,
      audit.actorLabel,
      audit.subjectType,
      audit.subjectId,
      audit.subjectLabel,
      audit.action,
      JSON.stringify(audit.payload),
      audit.occurredAt,
    ],
  );
}

function mapGallery(row: readonly SqlValue[]): GalleryRecord {
  const [id, type, url, caption, uploadedBy, uploadedByName, createdAt, revisionToken, mediaId] = row;
  if (
    typeof id !== "string" || (type !== "image" && type !== "video")
    || typeof uploadedBy !== "string" || typeof createdAt !== "string" || typeof revisionToken !== "string"
  ) throw corrupt("Invalid gallery row");
  const base = {
    id,
    caption: nullableString(caption),
    uploaded_by: uploadedBy,
    uploaded_by_name: nullableString(uploadedByName),
    created_at: createdAt,
    revisionToken,
  } as const;
  if (type === "image") {
    if (typeof mediaId !== "string" || url !== null) throw corrupt("Invalid gallery image row");
    return { ...base, type, media_id: mediaId, url: null };
  }
  if (typeof url !== "string" || mediaId !== null) throw corrupt("Invalid gallery video row");
  return { ...base, type, media_id: null, url };
}

function oneRow(result: SqlResult): readonly SqlValue[] | null {
  if (result.rows === undefined) return null;
  if (!Array.isArray(result.rows) || (result.rows.length > 0 && Array.isArray(result.rows[0]))) throw corrupt("Invalid SQLite get result");
  return result.rows as readonly SqlValue[];
}

function allRows(result: SqlResult): readonly (readonly SqlValue[])[] {
  if (result.rows === undefined) return [];
  if (!Array.isArray(result.rows) || result.rows.some((row) => !Array.isArray(row))) throw corrupt("Invalid SQLite all result");
  return result.rows as readonly (readonly SqlValue[])[];
}

function nullableString(value: SqlValue | undefined): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw corrupt("Invalid gallery string");
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
