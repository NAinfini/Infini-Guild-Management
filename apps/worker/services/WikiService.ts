import {
  wikiArticleSchema,
  wikiCategorySchema,
} from "@guild/shared";
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { wikiArticles, wikiCategories } from "../db/schema";
import { ok, err, type ServiceResult } from "./result";
import { escapeLikePattern } from "./helpers";

// --- Types ---

type DrizzleDb = DrizzleD1Database<Record<string, never>>;
type AuditLogInput = { entityType: string; action: string; actorId: string; entityId: string; diffTitle?: string | null; detailText?: string | null };

type CategoryRow = { id: string; name: string; slug: string; sortOrder: number; parentId: string | null; createdAt: string; updatedAt: string };
type ArticleRow = { id: string; title: string; slug: string; categoryId: string; bodyJson: string; sortOrder: number; pinned: boolean; archivedAt: string | null; createdBy: string; updatedBy: string | null; createdAt: string; updatedAt: string };

type EntityChangedInput = { entityType: string; entityId: string; hint: string };

export type WikiServiceDeps = {
  media: R2Bucket;
  writeAuditLog: (input: AuditLogInput) => Promise<void>;
  publishEntityChanged: (input: EntityChangedInput) => Promise<void>;
};

// --- Helpers ---

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || `wiki-${nanoid(6)}`;
}

function toCategoryPayload(row: CategoryRow) {
  return wikiCategorySchema.parse({ id: row.id, name: row.name, slug: row.slug, sort_order: row.sortOrder, parent_id: row.parentId, created_at: row.createdAt, updated_at: row.updatedAt });
}

function toArticlePayload(row: ArticleRow) {
  return wikiArticleSchema.parse({ id: row.id, title: row.title, slug: row.slug, category_id: row.categoryId, body_json: row.bodyJson, sort_order: row.sortOrder, pinned: row.pinned, archived_at: row.archivedAt, created_by: row.createdBy, updated_by: row.updatedBy, created_at: row.createdAt, updated_at: row.updatedAt });
}

const CATEGORY_COLS = { id: wikiCategories.id, name: wikiCategories.name, slug: wikiCategories.slug, sortOrder: wikiCategories.sortOrder, parentId: wikiCategories.parentId, createdAt: wikiCategories.createdAt, updatedAt: wikiCategories.updatedAt } as const;
const ARTICLE_COLS = { id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, categoryId: wikiArticles.categoryId, bodyJson: wikiArticles.bodyJson, sortOrder: wikiArticles.sortOrder, pinned: wikiArticles.pinned, archivedAt: wikiArticles.archivedAt, createdBy: wikiArticles.createdBy, updatedBy: wikiArticles.updatedBy, createdAt: wikiArticles.createdAt, updatedAt: wikiArticles.updatedAt } as const;

const LIST_ARTICLE_COLS = { id: wikiArticles.id, title: wikiArticles.title, slug: wikiArticles.slug, categoryId: wikiArticles.categoryId, sortOrder: wikiArticles.sortOrder, pinned: wikiArticles.pinned, archivedAt: wikiArticles.archivedAt, createdBy: wikiArticles.createdBy, updatedBy: wikiArticles.updatedBy, createdAt: wikiArticles.createdAt, updatedAt: wikiArticles.updatedAt } as const;

type ArticleListRow = Omit<ArticleRow, "bodyJson">;

function toArticleListPayload(row: ArticleListRow) {
  return {
    id: row.id, title: row.title, slug: row.slug, category_id: row.categoryId, body_json: "",
    sort_order: row.sortOrder, pinned: row.pinned, archived_at: row.archivedAt,
    created_by: row.createdBy, updated_by: row.updatedBy, created_at: row.createdAt, updated_at: row.updatedAt,
  };
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
    let slug = base;
    let suffix = 1;
    while ((await this.db.select({ id: wikiCategories.id }).from(wikiCategories).where(eq(wikiCategories.slug, slug)).limit(1))[0]) {
      suffix++;
      slug = `${base}-${suffix}`;
    }
    return slug;
  }

  private async uniqueArticleSlug(base: string): Promise<string> {
    let slug = base;
    let suffix = 1;
    while ((await this.db.select({ id: wikiArticles.id }).from(wikiArticles).where(eq(wikiArticles.slug, slug)).limit(1))[0]) {
      suffix++;
      slug = `${base}-${suffix}`;
    }
    return slug;
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
    await this.deps.writeAuditLog({ entityType: "wiki_category", action: "update", actorId, entityId: categoryId, diffTitle: updated.name, detailText: JSON.stringify(data) });
    await this.deps.publishEntityChanged({ entityType: "wiki", entityId: categoryId, hint: "category_updated" });
    return ok(toCategoryPayload(updated));
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

  async listArticles(opts: { page: number; limit: number; categoryId?: string; archived?: boolean; search?: string }): Promise<ServiceResult<{ data: unknown[]; total: number; page: number; limit: number; total_pages: number }>> {
    const offset = (opts.page - 1) * opts.limit;
    const filters: SQL<unknown>[] = [];
    if (opts.categoryId) filters.push(eq(wikiArticles.categoryId, opts.categoryId));
    if (opts.archived === true) { filters.push(isNotNull(wikiArticles.archivedAt)); } else { filters.push(isNull(wikiArticles.archivedAt)); }
    if (opts.search) {
      const pattern = `%${escapeLikePattern(opts.search)}%`;
      filters.push(or(like(wikiArticles.title, pattern), like(wikiArticles.bodyJson, pattern))!);
    }
    const whereClause = and(...filters);
    const totalRow = (await this.db.select({ count: sql<number>`count(*)` }).from(wikiArticles).where(whereClause))[0];
    const total = Number(totalRow?.count ?? 0);
    const rows = await this.db.select(LIST_ARTICLE_COLS).from(wikiArticles).where(whereClause).orderBy(desc(wikiArticles.pinned), asc(wikiArticles.sortOrder), desc(wikiArticles.updatedAt), asc(wikiArticles.id)).limit(opts.limit).offset(offset);
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
    await this.db.update(wikiArticles).set(patch).where(eq(wikiArticles.id, articleId));
    const updated = await this.getArticleById(articleId);
    if (!updated) return err("SERVER_ERROR", "Failed to load updated wiki article");
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "update", actorId, entityId: articleId, diffTitle: updated.title, detailText: JSON.stringify(data) });
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

  async uploadArticleImages(actorId: string, articleId: string, files: Array<{ data: ArrayBuffer; contentType: string }>): Promise<ServiceResult<{ keys: string[] }>> {
    const existing = await this.getArticleById(articleId);
    if (!existing) return err("NOT_FOUND", "Wiki article not found");
    const keys: string[] = [];
    for (const file of files) {
      const key = `wiki/${articleId}/images/${Date.now()}_${nanoid()}`;
      await this.deps.media.put(key, file.data, { httpMetadata: { contentType: file.contentType || "application/octet-stream" } });
      keys.push(key);
    }
    await this.deps.writeAuditLog({ entityType: "wiki_article", action: "upload_images", actorId, entityId: articleId, detailText: JSON.stringify({ keys }) });
    return ok({ keys });
  }
}
