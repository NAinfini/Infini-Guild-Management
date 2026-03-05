import {
  ERROR_STATUS,
  createWikiArticleSchema,
  createWikiCategorySchema,
  hasRoleAtLeast,
  updateWikiArticleSchema,
  wikiArticleSchema,
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
import { wikiArticles, wikiCategories } from "../db/schema";
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
  createdAt: string;
  updatedAt: string;
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
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
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
    created_at: row.createdAt,
    updated_at: row.updatedAt,
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
    updated_by: row.updatedBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
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
        createdAt: wikiCategories.createdAt,
        updatedAt: wikiCategories.updatedAt,
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
        updatedBy: wikiArticles.updatedBy,
        createdAt: wikiArticles.createdAt,
        updatedAt: wikiArticles.updatedAt,
      })
      .from(wikiArticles)
      .where(eq(wikiArticles.id, articleId))
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
      createdAt: wikiCategories.createdAt,
      updatedAt: wikiCategories.updatedAt,
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
      updatedBy: wikiArticles.updatedBy,
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
        updatedBy: wikiArticles.updatedBy,
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
    updatedBy: sessionUser.id,
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
      updatedBy: sessionUser.id,
    })
    .where(eq(wikiArticles.id, articleId));

  await writeAuditLog(c, {
    entityType: "wiki_article",
    action: "archive",
    actorId: sessionUser.id,
    entityId: articleId,
    diffTitle: existing.title,
  });

  return c.json({ ok: true });
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
