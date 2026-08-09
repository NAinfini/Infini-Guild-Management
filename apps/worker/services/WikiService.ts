import {
  wikiArticleSchema,
  wikiCategorySchema,
  wikiRevisionListItemSchema,
  wikiRevisionSchema,
  type JsonValue,
} from "@guild/shared";
import type { BatchUpdateWikiCategoryItem } from "@guild/shared";
import type {
  AuditLogStatementCondition,
  WriteAuditLogInput as AuditLogInput,
} from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { wikiArticles, wikiCategories, wikiRevisions } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, likeEscaped } from "./helpers";
import type { MediaService, ParsedImageMediaUpload } from "./MediaService";
import { extractRichTextMediaIds, MediaValidationError } from "./MediaService";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
export type WikiSort = "curated" | "updated_desc" | "updated_asc";

type CategoryRow = { id: string; name: string; slug: string; sortOrder: number; parentId: string | null; createdAt: string; updatedAt: string };
type ArticleRow = { id: string; title: string; slug: string; categoryId: string; bodyJson: string; sortOrder: number; pinned: boolean; archivedAt: string | null; createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string; updatedByUsername: string | null };
type RevisionListRow = { id: string; articleId: string; revision: number; title: string; editedBy: string; editedByUsername: string | null; restoredFrom: number | null; createdAt: string };
type RevisionRow = RevisionListRow & { bodyJson: string };

type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type WikiServiceDeps = {
  mediaService: MediaService;
  rawDb: D1Database;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  buildAuditLogStatements: (
    input: AuditLogInput,
    condition?: AuditLogStatementCondition,
  ) => D1PreparedStatement[];
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
};

// --- Helpers ---

/** Per-article revision retention cap; older snapshots are pruned on write. */
const MAX_REVISIONS_PER_ARTICLE = 50;

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || `wiki-${nanoid(6)}`;
}

function toCategoryPayload(row: CategoryRow) {
  return wikiCategorySchema.parse({ id: row.id, name: row.name, slug: row.slug, sort_order: row.sortOrder, parent_id: row.parentId, created_at: row.createdAt, updated_at: row.updatedAt });
}

function toArticlePayload(row: ArticleRow) {
  return wikiArticleSchema.parse({ id: row.id, title: row.title, slug: row.slug, category_id: row.categoryId, body_json: row.bodyJson, sort_order: row.sortOrder, pinned: row.pinned, archived_at: row.archivedAt, created_by: row.createdBy, updated_by: row.updatedBy, updated_by_username: row.updatedByUsername, created_at: row.createdAt, updated_at: row.updatedAt });
}

const CATEGORY_COLS = { id: wikiCategories.id, name: wikiCategories.name, slug: wikiCategories.slug, sortOrder: wikiCategories.sortOrder, parentId: wikiCategories.parentId, createdAt: wikiCategories.createdAt, updatedAt: wikiCategories.updatedAt } as const;
const ARTICLE_COLS = { id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, categoryId: wikiArticles.categoryId, bodyJson: wikiArticles.bodyJson, sortOrder: wikiArticles.sortOrder, pinned: wikiArticles.pinned, archivedAt: wikiArticles.archivedAt, createdBy: wikiArticles.createdBy, updatedBy: wikiArticles.updatedBy, updatedByUsername: sql<string | null>`(SELECT username FROM users WHERE id = COALESCE(${wikiArticles.updatedBy}, ${wikiArticles.createdBy}))`.as("updated_by_username"), createdAt: wikiArticles.createdAt, updatedAt: wikiArticles.updatedAt } as const;

const LIST_ARTICLE_COLS = { id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, categoryId: wikiArticles.categoryId, sortOrder: wikiArticles.sortOrder, pinned: wikiArticles.pinned, archivedAt: wikiArticles.archivedAt, createdBy: wikiArticles.createdBy, updatedBy: wikiArticles.updatedBy, updatedByUsername: sql<string | null>`(SELECT username FROM users WHERE id = COALESCE(${wikiArticles.updatedBy}, ${wikiArticles.createdBy}))`.as("updated_by_username"), createdAt: wikiArticles.createdAt, updatedAt: wikiArticles.updatedAt } as const;

const REVISION_LIST_COLS = { id: wikiRevisions.id, articleId: wikiRevisions.articleId, revision: wikiRevisions.revision, title: wikiRevisions.title, editedBy: wikiRevisions.editedBy, editedByUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${wikiRevisions.editedBy})`.as("edited_by_username"), restoredFrom: wikiRevisions.restoredFrom, createdAt: wikiRevisions.createdAt } as const;
const REVISION_COLS = { ...REVISION_LIST_COLS, bodyJson: wikiRevisions.bodyJson } as const;

function toRevisionListPayload(row: RevisionListRow) {
  return wikiRevisionListItemSchema.parse({ id: row.id, article_id: row.articleId, revision: row.revision, title: row.title, edited_by: row.editedBy, edited_by_username: row.editedByUsername, restored_from: row.restoredFrom, created_at: row.createdAt });
}

function toRevisionPayload(row: RevisionRow) {
  return wikiRevisionSchema.parse({ id: row.id, article_id: row.articleId, revision: row.revision, title: row.title, body_json: row.bodyJson, edited_by: row.editedBy, edited_by_username: row.editedByUsername, restored_from: row.restoredFrom, created_at: row.createdAt });
}

type ArticleListRow = Omit<ArticleRow, "bodyJson">;

function toArticleListPayload(row: ArticleListRow) {
  return {
    id: row.id, title: row.title, slug: row.slug, category_id: row.categoryId, body_json: "",
    sort_order: row.sortOrder, pinned: row.pinned, archived_at: row.archivedAt,
    created_by: row.createdBy, updated_by: row.updatedBy, updated_by_username: row.updatedByUsername, created_at: row.createdAt, updated_at: row.updatedAt,
  };
}

function buildCategoryDiff(
  existing: CategoryRow,
  data: { name?: string; slug?: string; sort_order?: number; parent_id?: string | null },
): Record<string, { from: JsonValue; to: JsonValue }> | null {
  const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
  if (data.name !== undefined && data.name !== existing.name) diff.name = { from: existing.name, to: data.name };
  if (data.slug !== undefined && slugify(data.slug) !== existing.slug) diff.slug = { from: existing.slug, to: slugify(data.slug) };
  if (data.sort_order !== undefined && data.sort_order !== existing.sortOrder) diff.sort_order = { from: existing.sortOrder, to: data.sort_order };
  if (data.parent_id !== undefined && (data.parent_id ?? null) !== existing.parentId) diff.parent_id = { from: existing.parentId, to: data.parent_id ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

function buildArticleDiff(
  existing: ArticleRow,
  data: { title?: string; slug?: string; category_id?: string; body_json?: string; sort_order?: number; pinned?: boolean; archived_at?: string | null },
): Record<string, { from: JsonValue; to: JsonValue }> | null {
  const diff: Record<string, { from: JsonValue; to: JsonValue }> = {};
  if (data.title !== undefined && data.title !== existing.title) diff.title = { from: existing.title, to: data.title };
  if (data.slug !== undefined && slugify(data.slug) !== existing.slug) diff.slug = { from: existing.slug, to: slugify(data.slug) };
  if (data.category_id !== undefined && data.category_id !== existing.categoryId) diff.category_id = { from: existing.categoryId, to: data.category_id };
  if (data.body_json !== undefined && data.body_json !== existing.bodyJson) diff.body_json = { from: "changed", to: "changed" };
  if (data.sort_order !== undefined && data.sort_order !== existing.sortOrder) diff.sort_order = { from: existing.sortOrder, to: data.sort_order };
  if (data.pinned !== undefined && data.pinned !== existing.pinned) diff.pinned = { from: existing.pinned, to: data.pinned };
  if (data.archived_at !== undefined && (data.archived_at ?? null) !== existing.archivedAt) diff.archived_at = { from: existing.archivedAt, to: data.archived_at ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

// --- Service ---

export class WikiService {
  private db: DrizzleDb;
  private deps: WikiServiceDeps;

  constructor(db: DrizzleDb, deps: WikiServiceDeps) {
    this.db = db;
    this.deps = deps;
  }

  // --- Private helpers ---

  private async getCategoryById(categoryId: string): Promise<CategoryRow | null> {
    return (await this.db.select(CATEGORY_COLS).from(wikiCategories).where(eq(wikiCategories.id, categoryId)).limit(1))[0] ?? null;
  }

  private async hasChildCategories(categoryId: string): Promise<boolean> {
    return Boolean((await this.db.select({ id: wikiCategories.id }).from(wikiCategories).where(eq(wikiCategories.parentId, categoryId)).limit(1))[0]);
  }

  private async getArticleById(articleId: string): Promise<ArticleRow | null> {
    return (await this.db.select(ARTICLE_COLS).from(wikiArticles).where(eq(wikiArticles.id, articleId)).limit(1))[0] ?? null;
  }

  private async uniqueCategorySlug(base: string): Promise<string> {
    const rows = await this.db.select({ slug: wikiCategories.slug }).from(wikiCategories).where(likeEscaped(wikiCategories.slug, `${escapeLikePattern(base)}%`));
    const existing = new Set(rows.map((r) => r.slug));
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
  }

  private async uniqueArticleSlug(base: string): Promise<string> {
    const rows = await this.db.select({ slug: wikiArticles.slug }).from(wikiArticles).where(likeEscaped(wikiArticles.slug, `${escapeLikePattern(base)}%`));
    const existing = new Set(rows.map((r) => r.slug));
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
  }

  // --- Revision helpers ---

  private async getRevisionMediaRows(articleId: string): Promise<Array<{ revision: number; bodyJson: string }>> {
    const rows = await this.db
      .select({ revision: wikiRevisions.revision, bodyJson: wikiRevisions.bodyJson })
      .from(wikiRevisions)
      .where(eq(wikiRevisions.articleId, articleId));
    return rows.filter((row) => Number.isInteger(row.revision) && typeof row.bodyJson === "string");
  }

  private collectArticleMediaIds(
    currentBodyJson: string,
    revisionRows: readonly { revision: number; bodyJson: string }[],
  ): string[] {
    const ids = new Set(extractRichTextMediaIds(currentBodyJson));
    for (const row of revisionRows) {
      for (const mediaId of extractRichTextMediaIds(row.bodyJson)) ids.add(mediaId);
    }
    return [...ids].sort();
  }

  private buildRevisionPlan(
    articleId: string,
    actorId: string,
    previous: ArticleRow,
    current: { title: string; bodyJson: string },
    committedAt: string,
    revisionRows: Array<{ revision: number; bodyJson: string }>,
    restoredFrom: number | null = null,
  ): { statements: D1PreparedStatement[]; retainedRows: Array<{ revision: number; bodyJson: string }> } {
    const latestRevision = revisionRows.reduce((max, row) => Math.max(max, row.revision), 0);
    const nextRevision = latestRevision === 0 ? 2 : latestRevision + 1;
    const cutoff = nextRevision - MAX_REVISIONS_PER_ARTICLE;
    const existsSql = "EXISTS (SELECT 1 FROM wiki_articles WHERE id = ? AND updated_at = ? AND title = ? AND body_json = ?)";
    const statements: D1PreparedStatement[] = [];
    if (latestRevision === 0) {
      statements.push(this.deps.rawDb.prepare(`
        INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by, restored_from, created_at)
        SELECT ?, ?, 1, ?, ?, ?, NULL, ? WHERE ${existsSql}
      `).bind(
        nanoid(), articleId, previous.title, previous.bodyJson,
        previous.updatedBy ?? previous.createdBy, previous.updatedAt,
        articleId, committedAt, current.title, current.bodyJson,
      ));
    }
    statements.push(this.deps.rawDb.prepare(`
      INSERT INTO wiki_revisions (id, article_id, revision, title, body_json, edited_by, restored_from, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${existsSql}
    `).bind(
      nanoid(), articleId, nextRevision, current.title, current.bodyJson, actorId, restoredFrom, committedAt,
      articleId, committedAt, current.title, current.bodyJson,
    ));
    if (cutoff > 0) {
      statements.push(this.deps.rawDb.prepare(`
        DELETE FROM wiki_revisions
        WHERE article_id = ? AND revision <= ? AND ${existsSql}
      `).bind(articleId, cutoff, articleId, committedAt, current.title, current.bodyJson));
    }

    const retainedRows = [
      ...(latestRevision === 0
        ? [{ revision: 1, bodyJson: previous.bodyJson }]
        : revisionRows),
      { revision: nextRevision, bodyJson: current.bodyJson },
    ].filter((row) => cutoff <= 0 || row.revision > cutoff);

    return { statements, retainedRows };
  }

  // --- Categories ---

  async listCategories(): Promise<ServiceResult<unknown[]>> {
    const rows = await this.db.select(CATEGORY_COLS).from(wikiCategories).orderBy(asc(wikiCategories.sortOrder), asc(wikiCategories.name), asc(wikiCategories.id));
    return ok(rows.map(toCategoryPayload));
  }

  async createCategory(actorId: string, data: { name: string; slug?: string; sort_order: number; parent_id?: string | null }): Promise<ServiceResult<unknown>> {
    if (data.parent_id) {
      const parent = await this.getCategoryById(data.parent_id);
      if (!parent) return err("NOT_FOUND", "Parent category not found");
      if (parent.parentId) return err("VALIDATION_ERROR", "Category nesting supports only one level");
    }
    const categoryId = nanoid();
    const slug = await this.uniqueCategorySlug(slugify(data.slug ?? data.name));
    await this.db.insert(wikiCategories).values({ id: categoryId, name: data.name, slug, sortOrder: data.sort_order, parentId: data.parent_id ?? null });
    const created = await this.getCategoryById(categoryId);
    if (!created) return err("SERVER_ERROR", "Failed to create wiki category");
    await this.deps.writeAuditLog({ entityType: "wiki_category", action: "create", actorId, entityId: categoryId, diffTitle: created.name });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: categoryId, hint: "category_created" });
    return ok(toCategoryPayload(created));
  }

  async updateCategory(actorId: string, categoryId: string, data: { name?: string; slug?: string; sort_order?: number; parent_id?: string | null }): Promise<ServiceResult<unknown>> {
    const existing = await this.getCategoryById(categoryId);
    if (!existing) return err("NOT_FOUND", "Wiki category not found");

    // Every category update advances the ordering/sync timestamp, including an empty patch.
    const patch: Partial<typeof wikiCategories.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.slug !== undefined) {
      const candidateSlug = slugify(data.slug);
      const conflict = (await this.db.select({ id: wikiCategories.id }).from(wikiCategories).where(and(eq(wikiCategories.slug, candidateSlug), sql`${wikiCategories.id} != ${categoryId}`)).limit(1))[0];
      if (conflict) return err("CONFLICT", "Slug already exists");
      patch.slug = candidateSlug;
    }
    if (data.sort_order !== undefined) patch.sortOrder = data.sort_order;
    if (data.parent_id !== undefined) {
      if (data.parent_id === categoryId) return err("VALIDATION_ERROR", "Category cannot be its own parent");
      if (data.parent_id) {
        const parent = await this.getCategoryById(data.parent_id);
        if (!parent) return err("NOT_FOUND", "Parent category not found");
        if (parent.parentId) return err("VALIDATION_ERROR", "Category nesting supports only one level");
        if (await this.hasChildCategories(categoryId)) return err("VALIDATION_ERROR", "Category with children cannot be nested under another parent");
      }
      patch.parentId = data.parent_id;
    }

    await this.db.update(wikiCategories).set(patch).where(eq(wikiCategories.id, categoryId));
    const updated = await this.getCategoryById(categoryId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated wiki category");
    const diff = buildCategoryDiff(existing, data);
    await this.deps.writeAuditLog({ entityType: "wiki_category", action: "update", actorId, entityId: categoryId, diffTitle: updated.name, detail: diff });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: categoryId, hint: "category_updated" });
    return ok(toCategoryPayload(updated));
  }

  /**
   * 一次提交多行分类改动（改名 / 换父级 / 换顺序），全部落在同一个 D1 batch 里。
   *
   * 逐行 PATCH 的问题不是慢，是没有原子性：第三行失败时，前两行已经落库，
   * 客户端既回滚不了，也无从知道停在了哪一行。这里要么整批生效，要么整批不生效，
   * 返回的永远是落库之后的完整目录。
   */
  async batchUpdateCategories(
    actorId: string,
    updates: BatchUpdateWikiCategoryItem[],
  ): Promise<ServiceResult<unknown[]>> {
    const rows = await this.db.select(CATEGORY_COLS).from(wikiCategories);
    const byId = new Map(rows.map((row) => [row.id, row]));

    const missing = updates.filter((update) => !byId.has(update.id)).map((update) => update.id);
    if (missing.length > 0) return err("NOT_FOUND", `Wiki category not found: ${missing.join(", ")}`);

    /* 父子关系要拿**整批落库之后**的状态来判，不能逐行拿当前库里的状态判：
       同一次提交里可以既把 A 挂到 B 下面、又把 B 挂到 C 下面，分开看每一步都合法，
       合起来却是两层嵌套。 */
    const projectedParent = new Map(rows.map((row) => [row.id, row.parentId]));
    for (const update of updates) {
      if (update.parent_id !== undefined) projectedParent.set(update.id, update.parent_id);
    }

    const touched = new Set(updates.map((update) => update.id));
    for (const [id, parentId] of projectedParent) {
      /* 只判这一批碰过的行，以及被挂到这一批某一行下面的行。库里原有的数据不该因为
         别处的一次保存被连坐判违规——那种脏数据要单独暴露，不是在这里拦。 */
      if (!parentId || (!touched.has(id) && !touched.has(parentId))) continue;
      if (parentId === id) return err("VALIDATION_ERROR", "Category cannot be its own parent");
      if (!projectedParent.has(parentId)) return err("NOT_FOUND", "Parent category not found");
      /* 父级自己还有父级 = 两层。这一条同时覆盖了「有子分类的分类不能再被挂到别人下面」：
         那种情况下正是它的子分类在这里撞上「父级还有父级」。 */
      if (projectedParent.get(parentId)) {
        return err("VALIDATION_ERROR", "Category nesting supports only one level");
      }
    }

    const updatedAt = new Date().toISOString();
    const diffs: Record<string, JsonValue> = {};
    const statements = updates.map((update) => {
      const assignments: string[] = [];
      const bindings: unknown[] = [];
      if (update.name !== undefined) { assignments.push("name = ?"); bindings.push(update.name); }
      if (update.parent_id !== undefined) { assignments.push("parent_id = ?"); bindings.push(update.parent_id); }
      if (update.sort_order !== undefined) { assignments.push("sort_order = ?"); bindings.push(update.sort_order); }
      assignments.push("updated_at = ?");
      bindings.push(updatedAt);

      const diff = buildCategoryDiff(byId.get(update.id)!, update);
      if (diff) diffs[update.id] = diff;

      return this.deps.rawDb
        .prepare(`UPDATE wiki_categories SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...bindings, update.id);
    });

    await this.deps.rawDb.batch([
      ...statements,
      /* entityId 用 "batch"：这次改的是一批分类，不是某一行。与 ClassCatalogService、
         GalleryService 的批量审计写法一致。 */
      ...this.deps.buildAuditLogStatements({
        entityType: "wiki_category",
        action: "batch_update",
        actorId,
        entityId: "batch",
        diffTitle: `${updates.length} categories updated`,
        detail: diffs,
      }),
    ]);

    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: "batch", hint: "category_updated" });
    return this.listCategories();
  }

  async deleteCategory(actorId: string, categoryId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getCategoryById(categoryId);
    if (!existing) return err("NOT_FOUND", "Wiki category not found");
    const hasArticles = (await this.db.select({ id: wikiArticles.id }).from(wikiArticles).where(eq(wikiArticles.categoryId, categoryId)).limit(1))[0];
    if (hasArticles) return err("CONFLICT", "Category must be empty before delete");
    if (await this.hasChildCategories(categoryId)) return err("CONFLICT", "Category has child categories");
    await this.db.delete(wikiCategories).where(eq(wikiCategories.id, categoryId));
    await this.deps.writeAuditLog({ entityType: "wiki_category", action: "delete", actorId, entityId: categoryId, diffTitle: existing.name });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: categoryId, hint: "category_deleted" });
    return ok({ ok: true });
  }

  // --- Articles ---

  async listArticles(opts: { page: number; limit: number; categoryIds?: string[]; archived?: boolean; pinned?: boolean; search?: string; sort?: WikiSort }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (opts.page - 1) * opts.limit;
    const filters: SQL<unknown>[] = [];
    if (opts.categoryIds?.length) filters.push(inArray(wikiArticles.categoryId, opts.categoryIds));
    if (opts.archived === true) { filters.push(isNotNull(wikiArticles.archivedAt)); }
    else if (opts.archived === false) { filters.push(isNull(wikiArticles.archivedAt)); }
    if (opts.pinned !== undefined) filters.push(eq(wikiArticles.pinned, opts.pinned));
    if (opts.search) {
      const pattern = `%${escapeLikePattern(opts.search)}%`;
      filters.push(or(likeEscaped(wikiArticles.title, pattern), likeEscaped(wikiArticles.bodyJson, pattern))!);
    }
    const whereClause = and(...filters);
    const sort = opts.sort ?? "curated";
    const orderExpressions = sort === "updated_asc"
      ? [desc(wikiArticles.pinned), asc(wikiArticles.updatedAt), asc(wikiArticles.id)]
      : sort === "updated_desc"
        ? [desc(wikiArticles.pinned), desc(wikiArticles.updatedAt), desc(wikiArticles.id)]
        : [desc(wikiArticles.pinned), asc(wikiArticles.sortOrder), desc(wikiArticles.updatedAt), asc(wikiArticles.id)];
    const [rows, countRow] = await Promise.all([
      this.db.select(LIST_ARTICLE_COLS).from(wikiArticles).where(whereClause).orderBy(...orderExpressions).limit(opts.limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(wikiArticles).where(whereClause),
    ]);
    const total = Number(countRow[0]?.count ?? 0);
    return ok({ data: rows.map(toArticleListPayload), total, page: opts.page, limit: opts.limit, total_pages: Math.max(1, Math.ceil(total / opts.limit)) });
  }

  async getArticleBySlug(slug: string): Promise<ServiceResult<unknown>> {
    const row = (await this.db.select(ARTICLE_COLS).from(wikiArticles).where(eq(wikiArticles.slug, slug)).limit(1))[0];
    if (!row) return err("NOT_FOUND", "Wiki article not found");
    return ok(toArticlePayload(row));
  }

  async createArticle(actorId: string, data: { title: string; slug?: string; category_id: string; body_json: string; sort_order: number; pinned: boolean }): Promise<ServiceResult<unknown>> {
    const articleId = nanoid();
    const slug = await this.uniqueArticleSlug(slugify(data.slug ?? data.title));
    const revisionId = nanoid();
    const nowIso = new Date().toISOString();
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare(`
        INSERT INTO wiki_articles
          (id, title, slug, category_id, body_json, sort_order, pinned, archived_at, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
      `).bind(articleId, data.title, slug, data.category_id, data.body_json, data.sort_order, data.pinned ? 1 : 0, actorId, nowIso, nowIso),
      this.deps.rawDb.prepare(`
        INSERT INTO wiki_revisions
          (id, article_id, revision, title, body_json, edited_by, restored_from, created_at)
        VALUES (?, ?, 1, ?, ?, ?, NULL, ?)
      `).bind(revisionId, articleId, data.title, data.body_json, actorId, nowIso),
    ]);
    try {
      const mediaIds = extractRichTextMediaIds(data.body_json);
      await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now: nowIso });
    } catch (error) {
      try {
        await this.deps.rawDb.prepare("DELETE FROM wiki_articles WHERE id = ?1").bind(articleId).run();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Wiki article ${articleId} attachment and parent cleanup both failed`);
      }
      if (error instanceof MediaValidationError) return err("FORBIDDEN", error.message);
      throw error;
    }
    const created = await this.getArticleById(articleId);
    if (!created) return err("SERVER_ERROR", "Failed to create wiki article");
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "create", actorId, entityId: articleId, diffTitle: created.title });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_created" });
    return ok(toArticlePayload(created));
  }

  async updateArticle(actorId: string, articleId: string, data: { title?: string; slug?: string; category_id?: string; body_json?: string; sort_order?: number; pinned?: boolean; archived_at?: string | null }, conditionalEtag?: string): Promise<ServiceResult<unknown>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    if (conditionalEtag) {
      const expectedEtag = `"wiki-${existing.id}-${existing.updatedAt}"`;
      if (conditionalEtag !== expectedEtag) return err("CONFLICT", "Article has been modified by another user");
    }
    const patch: Partial<typeof wikiArticles.$inferInsert> = { updatedAt: new Date().toISOString(), updatedBy: actorId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.slug !== undefined) {
      const candidateSlug = slugify(data.slug);
      const conflict = (await this.db.select({ id: wikiArticles.id }).from(wikiArticles).where(and(eq(wikiArticles.slug, candidateSlug), sql`${wikiArticles.id} != ${articleId}`)).limit(1))[0];
      if (conflict) return err("CONFLICT", "Slug already exists");
      patch.slug = candidateSlug;
    }
    if (data.category_id !== undefined) patch.categoryId = data.category_id;
    if (data.body_json !== undefined) patch.bodyJson = data.body_json;
    if (data.sort_order !== undefined) patch.sortOrder = data.sort_order;
    if (data.pinned !== undefined) patch.pinned = data.pinned;
    if (data.archived_at !== undefined) patch.archivedAt = data.archived_at;
    const nextTitle = data.title ?? existing.title;
    const nextBodyJson = data.body_json ?? existing.bodyJson;
    const contentChanged = nextTitle !== existing.title || nextBodyJson !== existing.bodyJson;
    const revisionRows = contentChanged ? await this.getRevisionMediaRows(articleId) : [];
    const revisionPlan = contentChanged
      ? this.buildRevisionPlan(
          articleId,
          actorId,
          existing,
          { title: nextTitle, bodyJson: nextBodyJson },
          patch.updatedAt as string,
          revisionRows,
        )
      : null;
    const previousMediaIds = contentChanged
      ? await this.deps.mediaService.listLinkedMediaIds("wiki_article", articleId, "body")
      : [];
    if (revisionPlan) {
      try {
        const mediaIds = this.collectArticleMediaIds(nextBodyJson, revisionPlan.retainedRows);
        await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now: patch.updatedAt as string });
      } catch (error) {
        if (error instanceof MediaValidationError) return err("FORBIDDEN", error.message);
        throw error;
      }
    }
    const assignments = ["updated_at = ?", "updated_by = ?"];
    const bindings: unknown[] = [patch.updatedAt, actorId];
    const add = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      bindings.push(value);
    };
    if (data.title !== undefined) add("title", data.title);
    if (patch.slug !== undefined) add("slug", patch.slug);
    if (data.category_id !== undefined) add("category_id", data.category_id);
    if (data.body_json !== undefined) add("body_json", data.body_json);
    if (data.sort_order !== undefined) add("sort_order", data.sort_order);
    if (data.pinned !== undefined) add("pinned", data.pinned ? 1 : 0);
    if (data.archived_at !== undefined) add("archived_at", data.archived_at);
    bindings.push(articleId);
    if (conditionalEtag) bindings.push(existing.updatedAt);
    let results: D1Result[];
    try {
      results = await this.deps.rawDb.batch([
        this.deps.rawDb.prepare(`
          UPDATE wiki_articles
          SET ${assignments.join(", ")}
          WHERE id = ?${conditionalEtag ? " AND updated_at = ?" : ""}
        `).bind(...bindings),
        ...(revisionPlan?.statements ?? []),
      ]);
    } catch (error) {
      if (revisionPlan) {
        try {
          await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: previousMediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now: patch.updatedAt as string });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Wiki article ${articleId} update and media rollback both failed`);
        }
      }
      throw error;
    }
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      if (revisionPlan) {
        await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: previousMediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now: patch.updatedAt as string });
      }
      return conditionalEtag
        ? err("CONFLICT", "Article has been modified by another user")
        : err("NOT_FOUND", "Wiki article not found");
    }
    const updated = await this.getArticleById(articleId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated wiki article");
    const diff = buildArticleDiff(existing, data);
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "update", actorId, entityId: articleId, diffTitle: updated.title, detail: diff });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_updated" });
    return ok(toArticlePayload(updated));
  }

  async archiveArticle(actorId: string, articleId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    const now = new Date().toISOString();
    await this.db.update(wikiArticles).set({ archivedAt: now, updatedAt: now, updatedBy: actorId }).where(eq(wikiArticles.id, articleId));
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "archive", actorId, entityId: articleId, diffTitle: existing.title });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_archived" });
    return ok({ ok: true });
  }

  async permanentDeleteArticle(actorId: string, articleId: string): Promise<ServiceResult<{ ok: true }>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    await this.deps.rawDb.batch([
      this.deps.rawDb.prepare("DELETE FROM wiki_revisions WHERE article_id = ?").bind(articleId),
      this.deps.rawDb.prepare("DELETE FROM wiki_articles WHERE id = ?").bind(articleId),
    ]);
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "delete", actorId, entityId: articleId, diffTitle: existing.title });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_deleted" });
    return ok({ ok: true });
  }

  // --- Revisions ---

  async listRevisions(articleId: string): Promise<ServiceResult<unknown[]>> {
    const article = await this.getArticleById(articleId);
    if (!article) return err("NOT_FOUND", "Wiki article not found");
    const rows = await this.db.select(REVISION_LIST_COLS).from(wikiRevisions).where(eq(wikiRevisions.articleId, articleId)).orderBy(desc(wikiRevisions.revision));
    return ok(rows.map(toRevisionListPayload));
  }

  async getRevision(articleId: string, revision: number): Promise<ServiceResult<unknown>> {
    const row = (await this.db.select(REVISION_COLS).from(wikiRevisions).where(and(eq(wikiRevisions.articleId, articleId), eq(wikiRevisions.revision, revision))).limit(1))[0];
    if (!row) return err("NOT_FOUND", "Wiki revision not found");
    return ok(toRevisionPayload(row));
  }

  async restoreRevision(actorId: string, articleId: string, revision: number): Promise<ServiceResult<unknown>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    const snapshot = (await this.db.select(REVISION_COLS).from(wikiRevisions).where(and(eq(wikiRevisions.articleId, articleId), eq(wikiRevisions.revision, revision))).limit(1))[0];
    if (!snapshot) return err("NOT_FOUND", "Wiki revision not found");
    if (snapshot.title === existing.title && snapshot.bodyJson === existing.bodyJson) {
      return err("VALIDATION_ERROR", "Revision content is identical to the current article");
    }
    const committedAt = new Date().toISOString();
    const revisionRows = await this.getRevisionMediaRows(articleId);
    const revisionPlan = this.buildRevisionPlan(
      articleId,
      actorId,
      existing,
      { title: snapshot.title, bodyJson: snapshot.bodyJson },
      committedAt,
      revisionRows,
      revision,
    );
    const previousMediaIds = await this.deps.mediaService.listLinkedMediaIds("wiki_article", articleId, "body");
    try {
      const mediaIds = this.collectArticleMediaIds(snapshot.bodyJson, revisionPlan.retainedRows);
      await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), ownerUserId: actorId, now: committedAt });
    } catch (error) {
      if (error instanceof MediaValidationError) return err("FORBIDDEN", error.message);
      throw error;
    }
    try {
      await this.deps.rawDb.batch([
        this.deps.rawDb.prepare("UPDATE wiki_articles SET title = ?, body_json = ?, updated_at = ?, updated_by = ? WHERE id = ?")
          .bind(snapshot.title, snapshot.bodyJson, committedAt, actorId, articleId),
        ...revisionPlan.statements,
      ]);
    } catch (error) {
      try {
        await this.deps.mediaService.replace({ entityType: "wiki_article", entityId: articleId, slot: "body", media: previousMediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })), now: committedAt });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Wiki article ${articleId} restore and media rollback both failed`);
      }
      throw error;
    }
    const updated = await this.getArticleById(articleId);
    if (!updated) return err("SERVER_ERROR", "Failed to load restored wiki article");
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "rollback", actorId, entityId: articleId, diffTitle: updated.title, detail: { restored_from: revision } });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_updated" });
    return ok(toArticlePayload(updated));
  }

  async uploadArticleImages(actorId: string, articleId: string, uploads: readonly ParsedImageMediaUpload[], quota: number, maxBytes: number): Promise<ServiceResult<{ media_ids: string[] }>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    const now = new Date().toISOString();
    if (!await this.deps.mediaService.checkQuota({ purpose: "wiki_image", ownerUserId: actorId, scope: { kind: "entity", entityType: "wiki_article", entityId: articleId }, limit: quota, incomingCount: uploads.length, now })) {
      return err("VALIDATION_ERROR", `Wiki image quota is ${quota}`);
    }
    let createdMediaIds: string[] = [];
    try {
      const created = await this.deps.mediaService.createImages({ ownerUserId: actorId, purpose: "wiki_image", uploads, now, maxBytes });
      createdMediaIds = created.mediaIds;
      await this.deps.writeAuditLog({ entityType: "wiki_article", action: "upload_images", actorId, entityId: articleId, diffTitle: existing.title ?? null, detail: { media_ids: created.mediaIds } });
      return ok({ media_ids: created.mediaIds });
    } catch (error) {
      if (createdMediaIds.length > 0) {
        try {
          await this.deps.mediaService.deleteAssets(createdMediaIds);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Wiki article ${articleId} image upload and media cleanup both failed`);
        }
      }
      if (error instanceof MediaValidationError) return err("VALIDATION_ERROR", error.message);
      throw error;
    }
  }
}
