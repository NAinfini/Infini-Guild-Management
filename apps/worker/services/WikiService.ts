import {
  wikiArticleSchema,
  wikiCategorySchema,
  wikiRevisionListItemSchema,
  wikiRevisionSchema,
} from "@guild/shared";
import type { BatchUpdateWikiCategoryItem } from "@guild/shared";
import type {
  AuditLogStatementCondition,
  WriteAuditLogInput as AuditLogInput,
} from "./audit";
import type { PushEntityType, PushHint } from "@guild/shared/constants/push-hints";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { wikiArticles, wikiCategories, wikiRevisions } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern, likeEscaped } from "./helpers";
import { replaceMediaRefs, deleteMediaRefs, extractRichTextMediaKeys } from "./media-references";
import { rethrowAfterUploadFailure } from "./media-upload-compensation";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;

type CategoryRow = { id: string; name: string; slug: string; sortOrder: number; parentId: string | null; createdAt: string; updatedAt: string };
type ArticleRow = { id: string; title: string; slug: string; categoryId: string; bodyJson: string; sortOrder: number; pinned: boolean; archivedAt: string | null; createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string; updatedByUsername: string | null };
type RevisionListRow = { id: string; articleId: string; revision: number; title: string; editedBy: string; editedByUsername: string | null; restoredFrom: number | null; createdAt: string };
type RevisionRow = RevisionListRow & { bodyJson: string };

type EntityChangedInput = { entityType: PushEntityType; entityId: string; hint: PushHint };

export type WikiServiceDeps = {
  media: R2Bucket;
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
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  if (data.name !== undefined && data.name !== existing.name) diff.name = { from: existing.name, to: data.name };
  if (data.slug !== undefined && slugify(data.slug) !== existing.slug) diff.slug = { from: existing.slug, to: slugify(data.slug) };
  if (data.sort_order !== undefined && data.sort_order !== existing.sortOrder) diff.sort_order = { from: existing.sortOrder, to: data.sort_order };
  if (data.parent_id !== undefined && (data.parent_id ?? null) !== existing.parentId) diff.parent_id = { from: existing.parentId, to: data.parent_id ?? null };
  return Object.keys(diff).length > 0 ? diff : null;
}

function buildArticleDiff(
  existing: ArticleRow,
  data: { title?: string; slug?: string; category_id?: string; body_json?: string; sort_order?: number; pinned?: boolean; archived_at?: string | null },
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
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

  private async latestRevisionNumber(articleId: string): Promise<number> {
    const row = (await this.db.select({ max: sql<number | null>`max(${wikiRevisions.revision})` }).from(wikiRevisions).where(eq(wikiRevisions.articleId, articleId)))[0];
    return Number(row?.max ?? 0);
  }

  private async insertRevision(articleId: string, revision: number, snapshot: { title: string; bodyJson: string; editedBy: string; restoredFrom?: number; createdAt?: string }): Promise<void> {
    await this.db.insert(wikiRevisions).values({
      id: nanoid(),
      articleId,
      revision,
      title: snapshot.title,
      bodyJson: snapshot.bodyJson,
      editedBy: snapshot.editedBy,
      restoredFrom: snapshot.restoredFrom ?? null,
      ...(snapshot.createdAt ? { createdAt: snapshot.createdAt } : {}),
    });
  }

  private async pruneRevisions(articleId: string, latestRevision: number): Promise<void> {
    const cutoff = latestRevision - MAX_REVISIONS_PER_ARTICLE;
    if (cutoff <= 0) return;
    await this.db.delete(wikiRevisions).where(and(eq(wikiRevisions.articleId, articleId), lte(wikiRevisions.revision, cutoff)));
  }

  /** Records the post-save content as a new revision. For articles created
   *  before revision tracking, the pre-edit state is captured first so it
   *  stays restorable. */
  private async snapshotContentChange(articleId: string, actorId: string, previous: { title: string; bodyJson: string; editedBy: string; editedAt: string }, current: { title: string; bodyJson: string }): Promise<void> {
    let latest = await this.latestRevisionNumber(articleId);
    if (latest === 0) {
      await this.insertRevision(articleId, 1, { title: previous.title, bodyJson: previous.bodyJson, editedBy: previous.editedBy, createdAt: previous.editedAt });
      latest = 1;
    }
    await this.insertRevision(articleId, latest + 1, { title: current.title, bodyJson: current.bodyJson, editedBy: actorId });
    await this.pruneRevisions(articleId, latest + 1);
  }

  /** Media refs = union of keys in the current body and all retained revision
   *  snapshots, so images referenced by restorable history survive the
   *  orphan-cleanup cron. */
  private async syncArticleMediaRefs(articleId: string, currentBodyJson: string): Promise<void> {
    const revisionRows = await this.db.select({ bodyJson: wikiRevisions.bodyJson }).from(wikiRevisions).where(eq(wikiRevisions.articleId, articleId));
    const keys = new Set(extractRichTextMediaKeys(currentBodyJson, "wiki", articleId));
    for (const row of revisionRows) {
      for (const key of extractRichTextMediaKeys(row.bodyJson, "wiki", articleId)) keys.add(key);
    }
    await replaceMediaRefs(this.deps.rawDb, "wiki_article", articleId, [...keys]);
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

    const patch: Partial<typeof wikiCategories.$inferInsert> = {};
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
    await this.deps.writeAuditLog({ entityType: "wiki_category", action: "update", actorId, entityId: categoryId, diffTitle: updated.name, detailText: diff ? JSON.stringify(diff) : null });
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
    const diffs: Record<string, unknown> = {};
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
        detailText: JSON.stringify(diffs),
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

  async listArticles(opts: { page: number; limit: number; categoryIds?: string[]; archived?: boolean; pinned?: boolean; search?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
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
    const [rows, countRow] = await Promise.all([
      this.db.select(LIST_ARTICLE_COLS).from(wikiArticles).where(whereClause).orderBy(desc(wikiArticles.pinned), asc(wikiArticles.sortOrder), desc(wikiArticles.updatedAt), asc(wikiArticles.id)).limit(opts.limit).offset(offset),
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
    await this.db.insert(wikiArticles).values({ id: articleId, title: data.title, slug, categoryId: data.category_id, bodyJson: data.body_json, sortOrder: data.sort_order, pinned: data.pinned, archivedAt: null, createdBy: actorId });
    const created = await this.getArticleById(articleId);
    if (!created) return err("SERVER_ERROR", "Failed to create wiki article");
    await this.insertRevision(articleId, 1, { title: created.title, bodyJson: created.bodyJson, editedBy: actorId });
    await replaceMediaRefs(this.deps.rawDb, "wiki_article", articleId, extractRichTextMediaKeys(created.bodyJson, "wiki", articleId));
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
    const updateWhere = conditionalEtag
      ? and(eq(wikiArticles.id, articleId), eq(wikiArticles.updatedAt, existing.updatedAt))
      : eq(wikiArticles.id, articleId);
    const updateQuery = this.db.update(wikiArticles).set(patch).where(updateWhere);
    if (conditionalEtag) {
      const updatedRows = await updateQuery.returning({ id: wikiArticles.id });
      if (updatedRows.length === 0) return err("CONFLICT", "Article has been modified by another user");
    } else {
      await updateQuery;
    }
    const updated = await this.getArticleById(articleId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated wiki article");
    const contentChanged = (data.title !== undefined && data.title !== existing.title) || (data.body_json !== undefined && data.body_json !== existing.bodyJson);
    if (contentChanged) {
      await this.snapshotContentChange(articleId, actorId, { title: existing.title, bodyJson: existing.bodyJson, editedBy: existing.updatedBy ?? existing.createdBy, editedAt: existing.updatedAt }, { title: updated.title, bodyJson: updated.bodyJson });
    }
    if (data.body_json !== undefined) {
      await this.syncArticleMediaRefs(articleId, updated.bodyJson);
    }
    const diff = buildArticleDiff(existing, data);
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "update", actorId, entityId: articleId, diffTitle: updated.title, detailText: diff ? JSON.stringify(diff) : null });
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
    await this.db.delete(wikiArticles).where(eq(wikiArticles.id, articleId));
    // Explicit revision cleanup: the FK cascade covers production, but local
    // mock D1 may run without foreign_keys enforcement.
    await this.db.delete(wikiRevisions).where(eq(wikiRevisions.articleId, articleId));
    await deleteMediaRefs(this.deps.rawDb, "wiki_article", articleId);
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
    await this.db.update(wikiArticles).set({ title: snapshot.title, bodyJson: snapshot.bodyJson, updatedAt: new Date().toISOString(), updatedBy: actorId }).where(eq(wikiArticles.id, articleId));
    const updated = await this.getArticleById(articleId);
    if (!updated) return err("SERVER_ERROR", "Failed to load restored wiki article");
    const latest = await this.latestRevisionNumber(articleId);
    await this.insertRevision(articleId, latest + 1, { title: snapshot.title, bodyJson: snapshot.bodyJson, editedBy: actorId, restoredFrom: revision });
    await this.pruneRevisions(articleId, latest + 1);
    await this.syncArticleMediaRefs(articleId, updated.bodyJson);
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "rollback", actorId, entityId: articleId, diffTitle: updated.title, detailText: JSON.stringify({ restored_from: revision }) });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: articleId, hint: "article_updated" });
    return ok(toArticlePayload(updated));
  }

  async uploadArticleImages(actorId: string, articleId: string, files: Array<{ data: ArrayBuffer; contentType: string }>): Promise<ServiceResult<{ keys: string[] }>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    const keys: string[] = [];
    try {
      for (const file of files) {
        // No media_references entry here: keys are added when the body_json referencing
        // them is saved (replaceMediaRefs). Unsaved uploads are orphans caught by the
        // media-orphan-cleanup cron's 48 h grace period.
        const key = `wiki/${articleId}/images/${Date.now()}_${nanoid()}`;
        keys.push(key);
        await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      }
      await this.deps.writeAuditLog({ entityType: "wiki_article", action: "upload_images", actorId, entityId: articleId, diffTitle: existing.title ?? null, detailText: JSON.stringify({ keys }) });
    } catch (error) {
      await rethrowAfterUploadFailure(
        error,
        (key) => this.deps.media.delete(key),
        keys,
      );
    }
    return ok({ keys });
  }
}
