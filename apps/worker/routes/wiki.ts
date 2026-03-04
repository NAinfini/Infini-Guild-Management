import {
  ERROR_STATUS,
  createWikiArticleSchema,
  createWikiCategorySchema,
  hasRoleAtLeast,
  updateWikiArticleSchema,
  wikiArticleSchema,
  wikiArticleVersionSchema,
  wikiCategorySchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { wikiArticles, wikiArticleVersions, wikiCategories } from "../db/schema";
import type { Bindings } from "../index";
import { resolveSession } from "../services/auth";
import { writeAuditLog } from "../services/audit";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  parentId: string | null;
};

type ArticleRow = {
  id: string;
  title: string;
  slug: string;
  categoryId: string;
  bodyJson: string;
  sortOrder: number;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ArticleVersionRow = {
  id: string;
  articleId: string;
  versionNo: number;
  title: string;
  slug: string;
  categoryId: string;
  bodyJson: string;
  sortOrder: number;
  archivedAt: string | null;
  sourceAction: string;
  createdBy: string;
  createdAt: string;
};

export const wikiRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toCategoryPayload(row: CategoryRow) {
  return wikiCategorySchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sort_order: row.sortOrder,
    parent_id: row.parentId,
  });
}

function toArticlePayload(row: ArticleRow) {
  return wikiArticleSchema.parse({
    id: row.id,
    title: row.title,
    slug: row.slug,
    category_id: row.categoryId,
    body_json: row.bodyJson,
    sort_order: row.sortOrder,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

function toArticleVersionPayload(row: ArticleVersionRow) {
  return wikiArticleVersionSchema.parse({
    id: row.id,
    article_id: row.articleId,
    version_no: row.versionNo,
    title: row.title,
    slug: row.slug,
    category_id: row.categoryId,
    body_json: row.bodyJson,
    sort_order: row.sortOrder,
    archived_at: row.archivedAt,
    source_action: row.sourceAction,
    created_by: row.createdBy,
    created_at: row.createdAt,
  });
}

async function getNextArticleVersionNo(c: Context, articleId: string): Promise<number> {
  const db = getDb(c);
  const row = (
    await db
      .select({ maxVersion: sql<number>`coalesce(max(${wikiArticleVersions.versionNo}), 0)` })
      .from(wikiArticleVersions)
      .where(eq(wikiArticleVersions.articleId, articleId))
  )[0];

  return Number(row?.maxVersion ?? 0) + 1;
}

async function createArticleVersion(
  c: Context,
  article: ArticleRow,
  actorId: string,
  sourceAction: string,
): Promise<void> {
  const db = getDb(c);
  const nextVersion = await getNextArticleVersionNo(c, article.id);

  await db.insert(wikiArticleVersions).values({
    id: nanoid(),
    articleId: article.id,
    versionNo: nextVersion,
    title: article.title,
    slug: article.slug,
    categoryId: article.categoryId,
    bodyJson: article.bodyJson,
    sortOrder: article.sortOrder,
    archivedAt: article.archivedAt,
    sourceAction,
    createdBy: actorId,
  });
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || `wiki-${nanoid(6)}`;
}

async function getCategoryById(c: Context, categoryId: string): Promise<CategoryRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: wikiCategories.id,
        name: wikiCategories.name,
        slug: wikiCategories.slug,
        sortOrder: wikiCategories.sortOrder,
        parentId: wikiCategories.parentId,
      })
      .from(wikiCategories)
      .where(eq(wikiCategories.id, categoryId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function hasChildCategories(c: Context, categoryId: string): Promise<boolean> {
  const db = getDb(c);
  const row = (
    await db
      .select({ id: wikiCategories.id })
      .from(wikiCategories)
      .where(eq(wikiCategories.parentId, categoryId))
      .limit(1)
  )[0];
  return Boolean(row);
}

async function getArticleById(c: Context, articleId: string): Promise<ArticleRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: wikiArticles.id,
        title: wikiArticles.title,
        slug: wikiArticles.slug,
        categoryId: wikiArticles.categoryId,
        bodyJson: wikiArticles.bodyJson,
        sortOrder: wikiArticles.sortOrder,
        archivedAt: wikiArticles.archivedAt,
        createdBy: wikiArticles.createdBy,
        createdAt: wikiArticles.createdAt,
        updatedAt: wikiArticles.updatedAt,
      })
      .from(wikiArticles)
      .where(eq(wikiArticles.id, articleId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function getArticleVersionById(c: Context, versionId: string): Promise<ArticleVersionRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: wikiArticleVersions.id,
        articleId: wikiArticleVersions.articleId,
        versionNo: wikiArticleVersions.versionNo,
        title: wikiArticleVersions.title,
        slug: wikiArticleVersions.slug,
        categoryId: wikiArticleVersions.categoryId,
        bodyJson: wikiArticleVersions.bodyJson,
        sortOrder: wikiArticleVersions.sortOrder,
        archivedAt: wikiArticleVersions.archivedAt,
        sourceAction: wikiArticleVersions.sourceAction,
        createdBy: wikiArticleVersions.createdBy,
        createdAt: wikiArticleVersions.createdAt,
      })
      .from(wikiArticleVersions)
      .where(eq(wikiArticleVersions.id, versionId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function requireRole(c: Context, requiredRole: Role): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  if (!hasRoleAtLeast(resolved.user.role, requiredRole)) {
    return buildError(c, "FORBIDDEN", "Insufficient role");
  }

  return resolved.user;
}

wikiRoutes.get("/categories", async (c) => {
  const db = getDb(c);
  const rows = await db
    .select({
      id: wikiCategories.id,
      name: wikiCategories.name,
      slug: wikiCategories.slug,
      sortOrder: wikiCategories.sortOrder,
      parentId: wikiCategories.parentId,
    })
    .from(wikiCategories)
    .orderBy(asc(wikiCategories.sortOrder), asc(wikiCategories.name), asc(wikiCategories.id));

  return c.json(rows.map(toCategoryPayload));
});

wikiRoutes.post("/categories", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createWikiCategorySchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  }

  const categoryId = nanoid();
  const slug = slugify(parsed.data.slug ?? parsed.data.name);
  const db = getDb(c);

  if (parsed.data.parent_id) {
    const parent = await getCategoryById(c, parsed.data.parent_id);
    if (!parent) {
      return buildError(c, "NOT_FOUND", "Parent category not found");
    }
    if (parent.parentId) {
      return buildError(c, "VALIDATION_ERROR", "Category nesting supports only one level");
    }
  }

  await db.insert(wikiCategories).values({
    id: categoryId,
    name: parsed.data.name,
    slug,
    sortOrder: parsed.data.sort_order,
    parentId: parsed.data.parent_id ?? null,
  });

  const created = await getCategoryById(c, categoryId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create wiki category");
  }

  await writeAuditLog(c, {
    entityType: "wiki_category",
    action: "create",
    actorId: sessionUser.id,
    entityId: categoryId,
    diffTitle: created.name,
  });

  return c.json(toCategoryPayload(created), 201);
});

wikiRoutes.patch("/categories/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const categoryId = c.req.param("id");
  const existing = await getCategoryById(c, categoryId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki category not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createWikiCategorySchema.partial().safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  }

  const patch: Partial<typeof wikiCategories.$inferInsert> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.slug !== undefined) patch.slug = slugify(parsed.data.slug);
  if (parsed.data.sort_order !== undefined) patch.sortOrder = parsed.data.sort_order;
  if (parsed.data.parent_id !== undefined) {
    if (parsed.data.parent_id === categoryId) {
      return buildError(c, "VALIDATION_ERROR", "Category cannot be its own parent");
    }
    if (parsed.data.parent_id) {
      const parent = await getCategoryById(c, parsed.data.parent_id);
      if (!parent) {
        return buildError(c, "NOT_FOUND", "Parent category not found");
      }
      if (parent.parentId) {
        return buildError(c, "VALIDATION_ERROR", "Category nesting supports only one level");
      }
      if (await hasChildCategories(c, categoryId)) {
        return buildError(c, "VALIDATION_ERROR", "Category with children cannot be nested under another parent");
      }
    }
    patch.parentId = parsed.data.parent_id;
  }

  const db = getDb(c);
  await db.update(wikiCategories).set(patch).where(eq(wikiCategories.id, categoryId));

  const updated = await getCategoryById(c, categoryId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated wiki category");
  }

  await writeAuditLog(c, {
    entityType: "wiki_category",
    action: "update",
    actorId: sessionUser.id,
    entityId: categoryId,
    diffTitle: updated.name,
    detailText: JSON.stringify(parsed.data),
  });

  return c.json(toCategoryPayload(updated));
});

wikiRoutes.delete("/categories/:id", async (c) => {
  const sessionUser = await requireRole(c, "admin");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const categoryId = c.req.param("id");
  const existing = await getCategoryById(c, categoryId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki category not found");
  }

  const db = getDb(c);
  const hasArticles = (
    await db.select({ id: wikiArticles.id }).from(wikiArticles).where(eq(wikiArticles.categoryId, categoryId)).limit(1)
  )[0];
  if (hasArticles) {
    return buildError(c, "CONFLICT", "Category must be empty before delete");
  }

  const hasChildren = (
    await db
      .select({ id: wikiCategories.id })
      .from(wikiCategories)
      .where(eq(wikiCategories.parentId, categoryId))
      .limit(1)
  )[0];
  if (hasChildren) {
    return buildError(c, "CONFLICT", "Category has child categories");
  }

  await db.delete(wikiCategories).where(eq(wikiCategories.id, categoryId));

  await writeAuditLog(c, {
    entityType: "wiki_category",
    action: "delete",
    actorId: sessionUser.id,
    entityId: categoryId,
    diffTitle: existing.name,
  });

  return c.json({ ok: true });
});

wikiRoutes.get("/articles", async (c) => {
  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const offset = (page - 1) * limit;
  const categoryId = query.category_id;
  const archivedFilter = parseBoolean(query.archived);
  const search = (query.search ?? "").trim();

  const filters: SQL<unknown>[] = [];
  if (categoryId) {
    filters.push(eq(wikiArticles.categoryId, categoryId));
  }

  if (archivedFilter === true) {
    filters.push(isNotNull(wikiArticles.archivedAt));
  } else {
    filters.push(isNull(wikiArticles.archivedAt));
  }

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(or(like(wikiArticles.title, pattern), like(wikiArticles.bodyJson, pattern))!);
  }

  const whereClause = and(...filters);
  const db = getDb(c);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(wikiArticles)
      .where(whereClause)
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      id: wikiArticles.id,
      title: wikiArticles.title,
      slug: wikiArticles.slug,
      categoryId: wikiArticles.categoryId,
      bodyJson: wikiArticles.bodyJson,
      sortOrder: wikiArticles.sortOrder,
      archivedAt: wikiArticles.archivedAt,
      createdBy: wikiArticles.createdBy,
      createdAt: wikiArticles.createdAt,
      updatedAt: wikiArticles.updatedAt,
    })
    .from(wikiArticles)
    .where(whereClause)
    .orderBy(asc(wikiArticles.sortOrder), desc(wikiArticles.updatedAt), asc(wikiArticles.id))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(toArticlePayload),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

wikiRoutes.get("/articles/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: wikiArticles.id,
        title: wikiArticles.title,
        slug: wikiArticles.slug,
        categoryId: wikiArticles.categoryId,
        bodyJson: wikiArticles.bodyJson,
        sortOrder: wikiArticles.sortOrder,
        archivedAt: wikiArticles.archivedAt,
        createdBy: wikiArticles.createdBy,
        createdAt: wikiArticles.createdAt,
        updatedAt: wikiArticles.updatedAt,
      })
      .from(wikiArticles)
      .where(eq(wikiArticles.slug, slug))
      .limit(1)
  )[0];

  if (!row) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  return c.json(toArticlePayload(row));
});

wikiRoutes.post("/articles", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createWikiArticleSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  }

  const articleId = nanoid();
  const slug = slugify(parsed.data.slug ?? parsed.data.title);
  const db = getDb(c);

  await db.insert(wikiArticles).values({
    id: articleId,
    title: parsed.data.title,
    slug,
    categoryId: parsed.data.category_id,
    bodyJson: parsed.data.body_json,
    sortOrder: parsed.data.sort_order,
    archivedAt: null,
    createdBy: sessionUser.id,
  });

  const created = await getArticleById(c, articleId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create wiki article");
  }

  await createArticleVersion(c, created, sessionUser.id, "create");

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "create",
    actorId: sessionUser.id,
    entityId: articleId,
    diffTitle: created.title,
  });

  return c.json(toArticlePayload(created), 201);
});

wikiRoutes.patch("/articles/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const articleId = c.req.param("id");
  const existing = await getArticleById(c, articleId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateWikiArticleSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  }

  const patch: Partial<typeof wikiArticles.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.slug !== undefined) patch.slug = slugify(parsed.data.slug);
  if (parsed.data.category_id !== undefined) patch.categoryId = parsed.data.category_id;
  if (parsed.data.body_json !== undefined) patch.bodyJson = parsed.data.body_json;
  if (parsed.data.sort_order !== undefined) patch.sortOrder = parsed.data.sort_order;
  if (parsed.data.archived_at !== undefined) patch.archivedAt = parsed.data.archived_at;

  const db = getDb(c);
  await db.update(wikiArticles).set(patch).where(eq(wikiArticles.id, articleId));

  const updated = await getArticleById(c, articleId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated wiki article");
  }

  const sourceAction =
    parsed.data.archived_at !== undefined
      ? parsed.data.archived_at === null
        ? "unarchive"
        : "archive"
      : "update";
  await createArticleVersion(c, updated, sessionUser.id, sourceAction);

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "update",
    actorId: sessionUser.id,
    entityId: articleId,
    diffTitle: updated.title,
    detailText: JSON.stringify(parsed.data),
  });

  return c.json(toArticlePayload(updated));
});

wikiRoutes.delete("/articles/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const articleId = c.req.param("id");
  const existing = await getArticleById(c, articleId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  const db = getDb(c);
  await db
    .update(wikiArticles)
    .set({
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(wikiArticles.id, articleId));

  const archived = await getArticleById(c, articleId);
  if (archived) {
    await createArticleVersion(c, archived, sessionUser.id, "archive");
  }

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "archive",
    actorId: sessionUser.id,
    entityId: articleId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
});

wikiRoutes.get("/articles/:id/versions", async (c) => {
  const articleId = c.req.param("id");
  const article = await getArticleById(c, articleId);
  if (!article) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const offset = (page - 1) * limit;
  const db = getDb(c);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(wikiArticleVersions)
      .where(eq(wikiArticleVersions.articleId, articleId))
  )[0];
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      id: wikiArticleVersions.id,
      articleId: wikiArticleVersions.articleId,
      versionNo: wikiArticleVersions.versionNo,
      title: wikiArticleVersions.title,
      slug: wikiArticleVersions.slug,
      categoryId: wikiArticleVersions.categoryId,
      bodyJson: wikiArticleVersions.bodyJson,
      sortOrder: wikiArticleVersions.sortOrder,
      archivedAt: wikiArticleVersions.archivedAt,
      sourceAction: wikiArticleVersions.sourceAction,
      createdBy: wikiArticleVersions.createdBy,
      createdAt: wikiArticleVersions.createdAt,
    })
    .from(wikiArticleVersions)
    .where(eq(wikiArticleVersions.articleId, articleId))
    .orderBy(desc(wikiArticleVersions.versionNo), desc(wikiArticleVersions.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(toArticleVersionPayload),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

wikiRoutes.get("/articles/:id/versions/compare", async (c) => {
  const articleId = c.req.param("id");
  const fromVersionId = c.req.query("from_version_id");
  const toVersionId = c.req.query("to_version_id");

  if (!fromVersionId || !toVersionId) {
    return buildError(c, "VALIDATION_ERROR", "from_version_id and to_version_id are required");
  }

  const fromVersion = await getArticleVersionById(c, fromVersionId);
  const toVersion = await getArticleVersionById(c, toVersionId);
  if (!fromVersion || !toVersion) {
    return buildError(c, "NOT_FOUND", "Wiki article version not found");
  }
  if (fromVersion.articleId !== articleId || toVersion.articleId !== articleId) {
    return buildError(c, "VALIDATION_ERROR", "Version does not belong to the selected article");
  }

  const changedFields: string[] = [];
  if (fromVersion.title !== toVersion.title) changedFields.push("title");
  if (fromVersion.slug !== toVersion.slug) changedFields.push("slug");
  if (fromVersion.categoryId !== toVersion.categoryId) changedFields.push("category_id");
  if (fromVersion.sortOrder !== toVersion.sortOrder) changedFields.push("sort_order");
  if (fromVersion.archivedAt !== toVersion.archivedAt) changedFields.push("archived_at");
  if (fromVersion.bodyJson !== toVersion.bodyJson) changedFields.push("body_json");

  return c.json({
    from_version: toArticleVersionPayload(fromVersion),
    to_version: toArticleVersionPayload(toVersion),
    changed_fields: changedFields,
  });
});

wikiRoutes.post("/articles/:id/versions/:versionId/rollback", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const articleId = c.req.param("id");
  const versionId = c.req.param("versionId");

  const existing = await getArticleById(c, articleId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  const version = await getArticleVersionById(c, versionId);
  if (!version) {
    return buildError(c, "NOT_FOUND", "Wiki article version not found");
  }
  if (version.articleId !== articleId) {
    return buildError(c, "VALIDATION_ERROR", "Version does not belong to the selected article");
  }

  const db = getDb(c);
  await db
    .update(wikiArticles)
    .set({
      title: version.title,
      slug: version.slug,
      categoryId: version.categoryId,
      bodyJson: version.bodyJson,
      sortOrder: version.sortOrder,
      archivedAt: version.archivedAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(wikiArticles.id, articleId));

  const updated = await getArticleById(c, articleId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load rolled back wiki article");
  }

  await createArticleVersion(c, updated, sessionUser.id, "rollback");

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "rollback",
    actorId: sessionUser.id,
    entityId: articleId,
    diffTitle: updated.title,
    detailText: JSON.stringify({ from_version_id: version.id, from_version_no: version.versionNo }),
  });

  return c.json(toArticlePayload(updated));
});

wikiRoutes.post("/articles/:id/images", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const articleId = c.req.param("id");
  const existing = await getArticleById(c, articleId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Wiki article not found");
  }

  const form = await c.req.formData();
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) {
    files.push(single);
  }

  for (const item of form.getAll("files")) {
    if (item instanceof File) {
      files.push(item);
    }
  }

  if (files.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "No files provided");
  }

  const env = c.env as Bindings;
  const keys: string[] = [];
  for (const file of files) {
    const key = `wiki/${articleId}/images/${Date.now()}_${nanoid()}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
    keys.push(key);
  }

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "upload_images",
    actorId: sessionUser.id,
    entityId: articleId,
    detailText: JSON.stringify({ keys }),
  });

  return c.json({ keys });
});
