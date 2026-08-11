import { AppError } from "@guild/kernel";
import type {
  WikiArticleListQuery,
  WikiArticleRecord,
  WikiCategoryRecord,
  WikiRevisionRecord,
  WikiStore,
} from "@guild/server/modules/wiki";
import { LIMITS, type PaginatedResponse, type WikiArticle, type WikiRevisionListItem } from "@guild/shared";
import type { SqlBatchStatement, SqlExecutor, SqlResult, SqlValue } from "@guild/kernel";
import { auditInsertStatement } from "./audit-statement.js";
import { returnedRowCount } from "./sql-result.js";

const MAX_WIKI_MEDIA = 50;
const WIKI_CATEGORY_COLUMNS = [
  "id", "name", "slug", "sort_order", "parent_id", "created_at", "updated_at", "revision_token",
] as const;
const WIKI_ARTICLE_COLUMNS = [
  "id", "title", "slug", "category_id", "body_json", "sort_order", "pinned", "archived_at", "deleted_at",
  "created_by", "updated_by", "editor_username", "created_at", "updated_at", "revision_token", "current_revision",
  "media_ids_json",
] as const;

export class SqliteWikiStore implements WikiStore {
  constructor(private readonly sql: SqlExecutor) {}

  async listCategories(): Promise<Readonly<{ records: readonly WikiCategoryRecord[]; stateToken: string }>> {
    const [stateResult, categoryResult] = await this.sql.batch([
      {
        method: "get",
        columns: ["revision_token"],
        sql: "SELECT revision_token FROM wiki_category_state WHERE singleton = 1",
      },
      {
        method: "all",
        columns: WIKI_CATEGORY_COLUMNS,
        sql: `${selectCategory()} ORDER BY categories.sort_order, categories.name, categories.id LIMIT ?`,
        params: [LIMITS.content.wikiCategoryCatalog.max + 1],
      },
    ]);
    const state = oneRow(requiredResult(stateResult));
    const stateToken = state?.[0];
    if (typeof stateToken !== "string") throw corrupt("Wiki category state is missing");
    const records = allRows(requiredResult(categoryResult)).map(mapCategory);
    if (records.length > LIMITS.content.wikiCategoryCatalog.max) {
      throw corrupt(`Wiki category data invariant violated: maximum is ${LIMITS.content.wikiCategoryCatalog.max}`);
    }
    return { records, stateToken };
  }

  async createCategory(input: Parameters<WikiStore["createCategory"]>[0]) {
    const expectedStateGuard = categoryStateGuard(input.expectedStateToken);
    const createdGuard = {
      sql: "SELECT 1 FROM wiki_categories WHERE id = ? AND revision_token = ?",
      params: [input.record.id, input.record.revisionToken],
    } as const;
    try {
      const results = await this.sql.batch([
        {
          method: "all",
          columns: ["category_id"],
          sql: `INSERT INTO wiki_categories
              (id, name, slug, sort_order, parent_id, revision_token, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (${expectedStateGuard.sql})
              AND (SELECT count(*) FROM wiki_categories) < ?
            RETURNING id AS category_id`,
          params: [
            input.record.id,
            input.record.name,
            input.record.slug,
            input.record.sort_order,
            input.record.parent_id,
            input.record.revisionToken,
            input.record.created_at,
            input.record.updated_at,
            ...expectedStateGuard.params,
            LIMITS.content.wikiCategoryCatalog.max,
          ],
        },
        {
          method: "all",
          columns: ["affected"],
          sql: `UPDATE wiki_category_state SET revision_token = ?, updated_at = ?
            WHERE singleton = 1 AND revision_token = ? AND EXISTS (${createdGuard.sql})
            RETURNING 1 AS affected`,
          params: [input.stateToken, input.record.updated_at, input.expectedStateToken, ...createdGuard.params],
        },
        auditInsertStatement(input.audit, categoryStateGuard(input.stateToken)),
        {
          method: "get",
          columns: ["revision_token", "category_count"],
          sql: `SELECT revision_token, (SELECT count(*) FROM wiki_categories) AS category_count
            FROM wiki_category_state WHERE singleton = 1`,
        },
      ]);
      const created = returnedRowCount(requiredResult(results[0])) === 1;
      const stateUpdated = returnedRowCount(requiredResult(results[1])) === 1;
      if (created && stateUpdated) return "created" as const;
      if (created !== stateUpdated) throw corrupt("Wiki category state update failed");
      const status = oneRow(requiredResult(results[3]));
      if (status?.[0] !== input.expectedStateToken) return "conflict" as const;
      if (status[1] === LIMITS.content.wikiCategoryCatalog.max) return "limit_reached" as const;
      throw corrupt("Wiki category create failed");
    } catch (error) {
      throw mapWikiConstraint(error);
    }
  }

  async updateCategories(input: Parameters<WikiStore["updateCategories"]>[0]): Promise<boolean> {
    if (input.records.length < 1 || input.records.length > LIMITS.content.wikiCategoryBatch.max) {
      throw new TypeError("Invalid wiki category update batch");
    }
    const json = JSON.stringify(input.records.map((record) => ({
      id: record.id,
      name: record.name,
      slug: record.slug,
      sort_order: record.sort_order,
      parent_id: record.parent_id,
      revision_token: record.revisionToken,
      updated_at: record.updated_at,
    })));
    const guard = categoryStateGuard(input.stateToken);
    try {
      const results = await this.sql.batch([
        updateCategoryState(input.expectedStateToken, input.stateToken, input.audit.occurredAt),
        {
          method: "run",
          sql: `UPDATE wiki_categories
            SET parent_id = NULL
            WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
              AND EXISTS (${guard.sql})`,
          params: [json, ...guard.params],
        },
        {
          method: "run",
          sql: `UPDATE wiki_categories AS categories
            SET name = (SELECT json_extract(value, '$.name') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id),
                slug = (SELECT json_extract(value, '$.slug') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id),
                sort_order = (SELECT json_extract(value, '$.sort_order') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id),
                parent_id = (SELECT json_extract(value, '$.parent_id') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id),
                revision_token = (SELECT json_extract(value, '$.revision_token') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id),
                updated_at = (SELECT json_extract(value, '$.updated_at') FROM json_each(?) WHERE json_extract(value, '$.id') = categories.id)
            WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
              AND EXISTS (${guard.sql})`,
          params: [json, json, json, json, json, json, json, ...guard.params],
        },
        auditInsertStatement(input.audit, guard),
      ]);
      return returnedRowCount(requiredResult(results[0])) === 1;
    } catch (error) {
      throw mapWikiConstraint(error);
    }
  }

  async deleteCategory(input: Parameters<WikiStore["deleteCategory"]>[0]): Promise<boolean> {
    const guard = categoryStateGuard(input.stateToken);
    try {
      const results = await this.sql.batch([
        updateCategoryState(input.expectedStateToken, input.stateToken, input.audit.occurredAt),
        auditInsertStatement(input.audit, guard),
        {
          method: "run",
          sql: `DELETE FROM wiki_categories WHERE id = ? AND EXISTS (${guard.sql})`,
          params: [input.id, ...guard.params],
        },
      ]);
      return returnedRowCount(requiredResult(results[0])) === 1;
    } catch (error) {
      throw mapWikiConstraint(error);
    }
  }

  async listArticles(query: WikiArticleListQuery): Promise<PaginatedResponse<WikiArticle>> {
    const { where, params } = articleWhere(query);
    const order = articleOrder(query.sort);
    const [countResult, listResult] = await this.sql.batch([
      {
        method: "get",
        columns: ["total"],
        sql: `SELECT COUNT(*) AS total FROM wiki_articles AS articles ${where}`,
        params,
      },
      {
        method: "all",
        columns: WIKI_ARTICLE_COLUMNS,
        sql: `${selectArticle(false)} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        params: [...params, query.limit, (query.page - 1) * query.limit],
      },
    ]);
    const count = oneRow(requiredResult(countResult))?.[0];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw corrupt("Invalid wiki article count");
    return {
      data: allRows(requiredResult(listResult)).map(mapArticleList),
      total: count,
      page: query.page,
      limit: query.limit,
      total_pages: Math.ceil(count / query.limit),
    };
  }

  async getArticleBySlug(slug: string, canReadArchived: boolean): Promise<WikiArticleRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${selectArticle(true)} WHERE articles.slug = ? AND articles.deleted_at IS NULL${canReadArchived ? "" : " AND articles.archived_at IS NULL"} LIMIT 1`,
      params: [slug],
    }));
    return row ? mapArticle(row) : null;
  }

  async getArticleById(id: string, includeDeleted = false): Promise<WikiArticleRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${selectArticle(true)} WHERE articles.id = ?${includeDeleted ? "" : " AND articles.deleted_at IS NULL"} LIMIT 1`,
      params: [id],
    }));
    return row ? mapArticle(row) : null;
  }

  async createArticle(input: Parameters<WikiStore["createArticle"]>[0]): Promise<void> {
    await this.assertArticleMedia(input.record, input.mediaIds);
    const statements: SqlBatchStatement[] = [
      insertArticle(input.record),
      insertRevision(input.initialRevision),
      insertRevisionMedia(input.initialRevision),
      insertMediaLinks(input.record.id, input.mediaIds, null, "public"),
      auditInsertStatement(input.audit),
    ];
    try {
      await this.sql.batch(statements);
    } catch (error) {
      throw mapWikiConstraint(error);
    }
  }

  async mutateArticle(input: Parameters<WikiStore["mutateArticle"]>[0]): Promise<boolean> {
    await this.assertArticleMedia(input.record, input.mediaIds);
    const guard = articleGuard(input.record.id, input.record.revisionToken);
    const statements: SqlBatchStatement[] = [
      updateArticle(input.record, input.expectedRevisionToken),
      insertRevision(input.revision, guard),
      insertRevisionMedia(input.revision, guard),
    ];
    statements.push({
      method: "run",
      sql: `DELETE FROM media_links
        WHERE entity_type = 'wiki_article' AND entity_id = ? AND slot = 'body'
          AND media_id NOT IN (SELECT value FROM json_each(?))
          AND EXISTS (${guard.sql})`,
      params: [input.record.id, JSON.stringify(input.mediaIds), ...guard.params],
    });
    statements.push({
      method: "run",
      sql: `UPDATE media_links SET sort_order = sort_order + 1000000
        WHERE entity_type = 'wiki_article' AND entity_id = ? AND slot = 'body'
          AND EXISTS (${guard.sql})`,
      params: [input.record.id, ...guard.params],
    });
    statements.push(insertMediaLinks(
      input.record.id,
      input.mediaIds,
      guard,
      input.record.archived_at || input.record.deletedAt ? "private" : "public",
    ));
    statements.push(auditInsertStatement(input.audit, guard));
    try {
      const results = await this.sql.batch(statements);
      return returnedRowCount(requiredResult(results[0])) === 1;
    } catch (error) {
      throw mapWikiConstraint(error);
    }
  }

  async listRevisions(
    articleId: string,
    query: Parameters<WikiStore["listRevisions"]>[1],
  ): Promise<readonly WikiRevisionListItem[]> {
    const result = await this.sql.execute({
      method: "all",
      sql: `${selectRevision(false)} WHERE revisions.article_id = ?
        ${query.beforeRevision === undefined ? "" : "AND revisions.revision < ?"}
        ORDER BY revisions.revision DESC LIMIT ?`,
      params: [articleId, ...(query.beforeRevision === undefined ? [] : [query.beforeRevision]), query.limit],
    });
    return allRows(result).map(mapRevisionList);
  }

  async getRevision(articleId: string, revision: number): Promise<WikiRevisionRecord | null> {
    const row = oneRow(await this.sql.execute({
      method: "get",
      sql: `${selectRevision(true)} WHERE revisions.article_id = ? AND revisions.revision = ? LIMIT 1`,
      params: [articleId, revision],
    }));
    return row ? mapRevision(row) : null;
  }

  private async assertArticleMedia(record: WikiArticleRecord, mediaIds: readonly string[]): Promise<readonly string[]> {
    if (mediaIds.length > MAX_WIKI_MEDIA || new Set(mediaIds).size !== mediaIds.length) {
      throw new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Wiki media must contain at most 50 unique assets" });
    }
    if (mediaIds.length === 0) return [];
    const result = oneRow(await this.sql.execute({
      method: "get",
      sql: `SELECT count(*) FROM media_assets AS assets
        WHERE assets.id IN (SELECT value FROM json_each(?))
          AND assets.purpose = 'wiki_image'
          AND assets.state IN ('staged', 'attached')
          AND (
            EXISTS (
              SELECT 1 FROM media_links
              WHERE media_id = assets.id AND entity_type = 'wiki_article'
                AND entity_id = ? AND slot = 'body'
            )
            OR EXISTS (
              SELECT 1 FROM wiki_revision_media AS revision_media
              JOIN wiki_revisions AS revisions ON revisions.id = revision_media.revision_id
              WHERE revision_media.media_id = assets.id AND revisions.article_id = ?
            )
            OR (
              assets.owner_user_id = ? AND assets.state = 'staged'
              AND NOT EXISTS (SELECT 1 FROM media_links WHERE media_id = assets.id)
              AND NOT EXISTS (SELECT 1 FROM wiki_revision_media WHERE media_id = assets.id)
            )
          )`,
      params: [JSON.stringify(mediaIds), record.id, record.id, record.updated_by ?? record.created_by],
    }));
    if (result?.[0] !== mediaIds.length) {
      throw new AppError({ code: "FORBIDDEN", status: 403, message: "Wiki media is not owned or retained by this article" });
    }
    return mediaIds;
  }
}

function updateCategoryState(expected: string, next: string, updatedAt: string): SqlBatchStatement {
  return {
    method: "all",
    columns: ["affected"],
    sql: `UPDATE wiki_category_state SET revision_token = ?, updated_at = ?
      WHERE singleton = 1 AND revision_token = ? RETURNING 1 AS affected`,
    params: [next, updatedAt, expected],
  };
}

function categoryStateGuard(token: string) {
  return { sql: "SELECT 1 FROM wiki_category_state WHERE singleton = 1 AND revision_token = ?", params: [token] } as const;
}

function articleGuard(id: string, revisionToken: string) {
  return { sql: "SELECT 1 FROM wiki_articles WHERE id = ? AND revision_token = ?", params: [id, revisionToken] } as const;
}

function selectCategory(): string {
  return `SELECT categories.id, categories.name, categories.slug, categories.sort_order,
    categories.parent_id, categories.created_at, categories.updated_at, categories.revision_token
    FROM wiki_categories AS categories`;
}

function selectArticle(withBody: boolean): string {
  return `SELECT articles.id, articles.title, articles.slug, articles.category_id,
    ${withBody ? "articles.body_json" : "'' AS body_json"}, articles.sort_order, articles.pinned,
    articles.archived_at, articles.deleted_at, articles.created_by, articles.updated_by,
    editor.username AS editor_username,
    articles.created_at, articles.updated_at, articles.revision_token, articles.current_revision,
    COALESCE((
      SELECT json_group_array(media_id) FROM (
        SELECT media_id FROM media_links
        WHERE entity_type = 'wiki_article' AND entity_id = articles.id AND slot = 'body'
        ORDER BY sort_order
      )
    ), '[]') AS media_ids_json
    FROM wiki_articles AS articles
    LEFT JOIN users AS editor ON editor.id = COALESCE(articles.updated_by, articles.created_by)`;
}

function selectRevision(withBody: boolean): string {
  return `SELECT revisions.id, revisions.article_id, revisions.revision, revisions.title,
    ${withBody ? "revisions.slug, revisions.category_id, revisions.body_json, revisions.sort_order, revisions.pinned, revisions.archived_at, revisions.deleted_at," : ""}
    revisions.edited_by, editor.username, revisions.restored_from, revisions.created_at
    ${withBody ? `, COALESCE((
      SELECT json_group_array(media_id) FROM (
        SELECT media_id FROM wiki_revision_media
        WHERE revision_id = revisions.id ORDER BY sort_order
      )
    ), '[]')` : ""}
    FROM wiki_revisions AS revisions
    LEFT JOIN users AS editor ON editor.id = revisions.edited_by`;
}

function insertArticle(record: WikiArticleRecord): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO wiki_articles
      (id, title, slug, category_id, body_json, sort_order, pinned, archived_at, created_by,
       deleted_at, updated_by, current_revision, revision_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      record.id, record.title, record.slug, record.category_id, record.body_json, record.sort_order,
      record.pinned ? 1 : 0, record.archived_at, record.created_by, record.deletedAt, record.updated_by,
      record.currentRevision, record.revisionToken, record.created_at, record.updated_at,
    ],
  };
}

function updateArticle(record: WikiArticleRecord, expectedRevisionToken: string): SqlBatchStatement {
  return {
    method: "all",
    columns: ["affected"],
    sql: `UPDATE wiki_articles SET
      title = ?, slug = ?, category_id = ?, body_json = ?, sort_order = ?, pinned = ?, archived_at = ?,
      deleted_at = ?, updated_by = ?, current_revision = ?, revision_token = ?, updated_at = ?
      WHERE id = ? AND revision_token = ?
      RETURNING 1 AS affected`,
    params: [
      record.title, record.slug, record.category_id, record.body_json, record.sort_order,
      record.pinned ? 1 : 0, record.archived_at, record.deletedAt, record.updated_by, record.currentRevision,
      record.revisionToken, record.updated_at, record.id, expectedRevisionToken,
    ],
  };
}

function insertRevision(record: WikiRevisionRecord, guard?: Readonly<{ sql: string; params: readonly SqlValue[] }>): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO wiki_revisions
      (id, article_id, revision, title, slug, category_id, body_json, sort_order, pinned,
       archived_at, deleted_at, edited_by, restored_from, created_at)
      ${guard
        ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})`
        : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"}`,
    params: [
      record.id, record.article_id, record.revision, record.title, record.slug, record.category_id,
      record.body_json, record.sort_order, record.pinned ? 1 : 0, record.archived_at,
      record.deleted_at, record.edited_by, record.restored_from, record.created_at,
      ...(guard?.params ?? []),
    ],
  };
}

function insertRevisionMedia(
  revision: WikiRevisionRecord,
  guard?: Readonly<{ sql: string; params: readonly SqlValue[] }>,
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO wiki_revision_media (revision_id, media_id, audience, sort_order)
      SELECT ?, media.value, 'private', CAST(media.key AS INTEGER)
      FROM json_each(?) AS media
      WHERE ${guard ? `EXISTS (${guard.sql})` : "1"}
      ORDER BY CAST(media.key AS INTEGER)`,
    params: [revision.id, JSON.stringify(revision.media_ids), ...(guard?.params ?? [])],
  };
}

function insertMediaLinks(
  articleId: string,
  mediaIds: readonly string[],
  guard: Readonly<{ sql: string; params: readonly SqlValue[] }> | null,
  audience: "public" | "private",
): SqlBatchStatement {
  return {
    method: "run",
    sql: `INSERT INTO media_links (media_id, entity_type, entity_id, slot, audience, sort_order)
      SELECT media.value, 'wiki_article', ?, 'body', ?, CAST(media.key AS INTEGER)
      FROM json_each(?) AS media
      WHERE ${guard ? `EXISTS (${guard.sql})` : "1"}
      ON CONFLICT(entity_type, entity_id, slot, media_id) DO UPDATE SET
        audience = excluded.audience,
        sort_order = excluded.sort_order`,
    params: [articleId, audience, JSON.stringify(mediaIds), ...(guard?.params ?? [])],
  };
}

function articleWhere(query: WikiArticleListQuery): Readonly<{ where: string; params: SqlValue[] }> {
  const clauses: string[] = ["articles.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (!query.canReadArchived || query.archived === false) clauses.push("articles.archived_at IS NULL");
  else if (query.archived === true) clauses.push("articles.archived_at IS NOT NULL");
  if (query.pinned !== undefined) { clauses.push("articles.pinned = ?"); params.push(query.pinned ? 1 : 0); }
  if (query.categoryIds.length) {
    clauses.push("articles.category_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(query.categoryIds));
  }
  if (query.search) {
    clauses.push("(lower(articles.title) LIKE ? ESCAPE '\\' OR lower(articles.slug) LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    params.push(pattern, pattern);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function articleOrder(sort: WikiArticleListQuery["sort"]): string {
  if (sort === "updated_desc") return "articles.updated_at DESC, articles.id DESC";
  if (sort === "updated_asc") return "articles.updated_at ASC, articles.id ASC";
  return "articles.pinned DESC, articles.sort_order ASC, articles.title ASC, articles.id ASC";
}

function mapCategory(row: readonly SqlValue[]): WikiCategoryRecord {
  const [id, name, slug, sortOrder, parentId, createdAt, updatedAt, revisionToken] = row;
  if (typeof id !== "string" || typeof name !== "string" || typeof slug !== "string" || typeof sortOrder !== "number"
    || (parentId !== null && typeof parentId !== "string") || typeof createdAt !== "string"
    || typeof updatedAt !== "string" || typeof revisionToken !== "string") throw corrupt("Invalid wiki category row");
  return { id, name, slug, sort_order: sortOrder, parent_id: parentId, created_at: createdAt, updated_at: updatedAt, revisionToken };
}

function mapArticle(row: readonly SqlValue[]): WikiArticleRecord {
  const [id, title, slug, categoryId, bodyJson, sortOrder, pinned, archivedAt, deletedAt, createdBy, updatedBy,
    updatedByUsername, createdAt, updatedAt, revisionToken, currentRevision, mediaIdsJson] = row;
  if (typeof id !== "string" || typeof title !== "string" || typeof slug !== "string" || typeof categoryId !== "string"
    || typeof bodyJson !== "string" || typeof sortOrder !== "number" || (pinned !== 0 && pinned !== 1)
    || (archivedAt !== null && typeof archivedAt !== "string") || typeof createdBy !== "string"
    || (deletedAt !== null && typeof deletedAt !== "string")
    || (updatedBy !== null && typeof updatedBy !== "string") || (updatedByUsername !== null && typeof updatedByUsername !== "string")
    || typeof createdAt !== "string" || typeof updatedAt !== "string" || typeof revisionToken !== "string"
    || typeof currentRevision !== "number" || typeof mediaIdsJson !== "string") throw corrupt("Invalid wiki article row");
  return {
    id, title, slug, category_id: categoryId, body_json: bodyJson, sort_order: sortOrder, pinned: pinned === 1,
    archived_at: archivedAt, created_by: createdBy, updated_by: updatedBy, updated_by_username: updatedByUsername,
    created_at: createdAt, updated_at: updatedAt, revisionToken, currentRevision,
    deletedAt, mediaIds: parseStringArray(mediaIdsJson, "wiki article media"),
  };
}

function mapArticleList(row: readonly SqlValue[]): WikiArticle {
  const {
    revisionToken: _token,
    currentRevision: _revision,
    deletedAt: _deletedAt,
    mediaIds: _mediaIds,
    ...article
  } = mapArticle(row);
  return article;
}

function mapRevisionList(row: readonly SqlValue[]): WikiRevisionListItem {
  const [id, articleId, revision, title, editedBy, editedByUsername, restoredFrom, createdAt] = row;
  if (typeof id !== "string" || typeof articleId !== "string" || typeof revision !== "number"
    || typeof title !== "string" || typeof editedBy !== "string"
    || (editedByUsername !== null && typeof editedByUsername !== "string")
    || (restoredFrom !== null && typeof restoredFrom !== "number") || typeof createdAt !== "string") {
    throw corrupt("Invalid wiki revision row");
  }
  return {
    id, article_id: articleId, revision, title, edited_by: editedBy,
    edited_by_username: editedByUsername, restored_from: restoredFrom, created_at: createdAt,
  };
}

function mapRevision(row: readonly SqlValue[]): WikiRevisionRecord {
  const [id, articleId, revision, title, slug, categoryId, bodyJson, sortOrder, pinned, archivedAt, deletedAt,
    editedBy, editedByUsername, restoredFrom, createdAt, mediaIdsJson] = row;
  if (typeof slug !== "string" || typeof categoryId !== "string" || typeof bodyJson !== "string"
    || typeof sortOrder !== "number" || (pinned !== 0 && pinned !== 1)
    || (archivedAt !== null && typeof archivedAt !== "string")
    || (deletedAt !== null && typeof deletedAt !== "string") || typeof mediaIdsJson !== "string") {
    throw corrupt("Invalid wiki revision snapshot");
  }
  const base = mapRevisionList([id!, articleId!, revision!, title!, editedBy!, editedByUsername!, restoredFrom!, createdAt!]);
  return {
    ...base,
    slug,
    category_id: categoryId,
    body_json: bodyJson,
    sort_order: sortOrder,
    pinned: pinned === 1,
    archived_at: archivedAt,
    deleted_at: deletedAt,
    media_ids: parseStringArray(mediaIdsJson, "wiki revision media"),
  };
}

function parseStringArray(value: string, label: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw corrupt(`Invalid ${label}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw corrupt(`Invalid ${label}`);
  }
  return parsed;
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

function requiredResult(result: SqlResult | undefined): SqlResult {
  if (!result) throw corrupt("SQLite batch result is missing");
  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function mapWikiConstraint(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed: wiki_(?:categories|articles)\.slug/i.test(message)) {
    return new AppError({ code: "CONFLICT", status: 409, message: "Wiki slug already exists", cause: error });
  }
  if (/FOREIGN KEY constraint failed|still has children|still in use/i.test(message)) {
    return new AppError({ code: "CONFLICT", status: 409, message: "Wiki category is still in use", cause: error });
  }
  return error;
}

function corrupt(message: string): AppError {
  return new AppError({ code: "SERVER_ERROR", status: 500, message });
}
