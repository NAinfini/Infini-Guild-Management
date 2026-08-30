import { AppError } from "@guild/kernel";
import type { GalleryLikeWriteResult, GalleryListQuery, GalleryRecord, GalleryStore } from "@guild/server/modules/gallery";
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
      params: [query.viewerUserId ?? "", ...params, query.limit + 1],
    });
    const rows = allRows(result).map(mapGallery);
    return { data: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
  }

  async get(id: string, viewerUserId: string | null): Promise<GalleryRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${selectGallery()} WHERE items.id = ? LIMIT 1`,
      params: [viewerUserId ?? "", id],
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
      sql: `INSERT INTO gallery_items (id, type, url, caption, uploaded_by, revision_token, created_at, title)
        SELECT
          json_extract(record.value, '$.id'),
          json_extract(record.value, '$.type'),
          json_extract(record.value, '$.url'),
          json_extract(record.value, '$.description'),
          json_extract(record.value, '$.uploaded_by'),
          json_extract(record.value, '$.revisionToken'),
          json_extract(record.value, '$.created_at'),
          json_extract(record.value, '$.title')
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

  async updateMetadata(input: Parameters<GalleryStore["updateMetadata"]>[0]): Promise<boolean> {
    const guard = {
      sql: "SELECT 1 FROM gallery_items WHERE id = ? AND revision_token = ?",
      params: [input.id, input.newRevisionToken],
    } as const;
    const results = await this.sql.batch([
      {
        method: "all",
        columns: ["affected"],
        sql: `UPDATE gallery_items
          SET title = ?, caption = ?, revision_token = ?
          WHERE id = ? AND revision_token = ?
          RETURNING 1 AS affected`,
        params: [
          input.title,
          input.description,
          input.newRevisionToken,
          input.id,
          input.expectedRevisionToken,
        ],
      },
      auditInsertStatement(input.audit, guard),
    ]);
    return returnedRowCount(results[0]) === 1;
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

  async setLike(input: Parameters<GalleryStore["setLike"]>[0]): Promise<GalleryLikeWriteResult> {
    const marker = input.audit.occurredAt;
    const itemGuard = {
      sql: "SELECT 1 FROM gallery_items WHERE id = ?",
      params: [input.id],
    } as const;
    const changedGuard = {
      sql: "SELECT 1 FROM gallery_likes WHERE item_id = ? AND user_id = ? AND created_at = ?",
      params: [input.id, input.userId, marker],
    } as const;
    const statements: SqlBatchStatement[] = input.liked
      ? [
          {
            method: "all",
            columns: ["affected"],
            sql: `INSERT INTO gallery_likes (item_id, user_id, created_at)
              SELECT ?, ?, ? WHERE EXISTS (${itemGuard.sql})
              ON CONFLICT(item_id, user_id) DO NOTHING RETURNING 1 AS affected`,
            params: [input.id, input.userId, marker, ...itemGuard.params],
          },
          auditInsertStatement(input.audit, changedGuard),
        ]
      : [
          {
            method: "all",
            columns: ["affected"],
            sql: `UPDATE gallery_likes SET created_at = ?
              WHERE item_id = ? AND user_id = ? AND EXISTS (${itemGuard.sql})
              RETURNING 1 AS affected`,
            params: [marker, input.id, input.userId, ...itemGuard.params],
          },
          auditInsertStatement(input.audit, changedGuard),
          {
            method: "run",
            sql: "DELETE FROM gallery_likes WHERE item_id = ? AND user_id = ? AND created_at = ?",
            params: [input.id, input.userId, marker],
          },
        ];
    statements.push({
      method: "get",
      columns: ["item_exists"],
      sql: "SELECT EXISTS(SELECT 1 FROM gallery_items WHERE id = ?) AS item_exists",
      params: [input.id],
    });
    statements.push({
      method: "get",
      columns: ["like_count"],
      sql: "SELECT count(*) AS like_count FROM gallery_likes WHERE item_id = ?",
      params: [input.id],
    });
    const results = await this.sql.batch(statements);
    const existenceResult = results.at(-2);
    if (!existenceResult) throw corrupt("Missing gallery item existence result");
    const existenceRow = oneRow(existenceResult);
    if (!existenceRow || (existenceRow[0] !== 0 && existenceRow[0] !== 1)) {
      throw corrupt("Invalid gallery item existence result");
    }
    if (existenceRow[0] === 0) return { outcome: "not_found" };
    const countResult = results.at(-1);
    if (!countResult) throw corrupt("Missing gallery like count");
    const countRow = oneRow(countResult);
    if (!countRow || typeof countRow[0] !== "number") throw corrupt("Invalid gallery like count");
    return { outcome: "ok", changed: returnedRowCount(results[0]) === 1, likeCount: countRow[0] };
  }
}

function galleryWhere(query: GalleryListQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (query.type) { clauses.push("items.type = ?"); params.push(query.type); }
  if (query.dateFrom) { clauses.push("items.created_at >= ?"); params.push(query.dateFrom); }
  if (query.dateTo) { clauses.push("items.created_at <= ?"); params.push(query.dateTo); }
  if (query.search) {
    clauses.push("(lower(items.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(items.caption, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(users.display_name, '')) LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    params.push(pattern, pattern, pattern);
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
    items.id, items.type, items.url, items.title, items.caption, items.uploaded_by, users.display_name,
    items.created_at, items.revision_token, links.media_id,
    (SELECT count(*) FROM gallery_likes AS likes WHERE likes.item_id = items.id) AS like_count,
    EXISTS(SELECT 1 FROM gallery_likes AS viewer_like WHERE viewer_like.item_id = items.id AND viewer_like.user_id = ?) AS liked_by_viewer
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
    sql: `INSERT INTO gallery_items (id, type, url, caption, uploaded_by, revision_token, created_at, title)
      ${guard ? `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})` : "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"}
      RETURNING 1 AS affected`,
    params: [
      record.id,
      record.type,
      record.url,
      record.description,
      record.uploaded_by,
      record.revisionToken,
      record.created_at,
      record.title,
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
       SELECT id, type, title FROM gallery_items WHERE revision_token = ?
     )
     SELECT ?, ?, ?, ?,
       CASE WHEN ? = 'user' THEN (SELECT display_name FROM users WHERE id = ?) ELSE ? END,
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
                 'value', json_object('id', id, 'label', title)
               ))
               FROM (SELECT id, type, title FROM changed ORDER BY id)
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
  const [id, type, url, title, description, uploadedBy, uploadedByName, createdAt, revisionToken, mediaId,
    likeCount, likedByViewer] = row;
  if (
    typeof id !== "string" || (type !== "image" && type !== "video")
    || typeof title !== "string" || typeof uploadedBy !== "string" || typeof createdAt !== "string"
    || typeof revisionToken !== "string" || typeof likeCount !== "number"
    || (likedByViewer !== 0 && likedByViewer !== 1)
  ) throw corrupt("Invalid gallery row");
  const base = {
    id,
    title,
    description: nullableString(description),
    uploaded_by: uploadedBy,
    uploaded_by_name: nullableString(uploadedByName),
    like_count: likeCount,
    liked_by_viewer: likedByViewer === 1,
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
