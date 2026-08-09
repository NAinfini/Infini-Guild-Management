import {
  batchUpdateWikiCategoriesSchema,
  createWikiArticleSchema,
  createWikiCategorySchema,
  updateWikiCategorySchema,
  updateWikiArticleSchema,
} from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { requirePermission } from "../middleware/rbac";
import { buildAuditLogStatements } from "../services/audit";
import { MediaValidationError, parseImageMediaFormData } from "../services/MediaService";
import { WikiService, type WikiSort } from "../services/WikiService";
import { buildError, getDb, handleResult, parseBoolean, parseJsonBody, parsePage, safeFormData } from "./_shared";
import { withMedia } from "./service-factory";

export const wikiRoutes = new Hono();

function parseWikiSort(value: string | undefined): WikiSort | null {
  if (value === undefined) return "curated";
  return value === "curated" || value === "updated_desc" || value === "updated_asc" ? value : null;
}

function getService(c: Context): WikiService {
  return new WikiService(getDb(c), {
    ...withMedia(c),
    buildAuditLogStatements: (input, condition) => buildAuditLogStatements(c, input, condition),
  });
}

async function requireWikiArticlesCreate(c: Context) { return requirePermission(c, "wiki.articles.create"); }
async function requireWikiArticlesEdit(c: Context) { return requirePermission(c, "wiki.articles.edit"); }
async function requireWikiCategoriesManage(c: Context) { return requirePermission(c, "wiki.categories.manage"); }

// --- Category routes ---

wikiRoutes.get("/categories", async (c) => {
  const result = await getService(c).listCategories();
  return handleResult(c, result);
});

wikiRoutes.post("/categories", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  const body = await parseJsonBody(c);
  const parsed = createWikiCategorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  const result = await getService(c).createCategory(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

/* 必须排在 `/categories/:id` 之前：Hono 按注册顺序匹配，否则 "batch" 会被当成一个分类 id。 */
wikiRoutes.patch("/categories/batch", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  const body = await parseJsonBody(c);
  const parsed = batchUpdateWikiCategoriesSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki category batch payload", parsed.error.flatten());
  const result = await getService(c).batchUpdateCategories(sessionUser.id, parsed.data.updates);
  return handleResult(c, result);
});

wikiRoutes.patch("/categories/:id", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  const body = await parseJsonBody(c);
  const parsed = updateWikiCategorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  const result = await getService(c).updateCategory(sessionUser.id, c.req.param("id"), parsed.data);
  return handleResult(c, result);
});

wikiRoutes.delete("/categories/:id", async (c) => {
  const sessionUser = await requirePermission(c, "wiki.categories.manage");
  const result = await getService(c).deleteCategory(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

// --- Article routes ---

wikiRoutes.get("/articles", async (c) => {
  const query = c.req.query();
  const sort = parseWikiSort(query.sort);
  if (!sort) return buildError(c, "VALIDATION_ERROR", "Invalid wiki sort");
  const categoryIds = [...new Set(
    (c.req.queries("category_id") ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  if (categoryIds.length > 100) {
    return buildError(c, "VALIDATION_ERROR", "Maximum 100 category_id values");
  }
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const result = await getService(c).listArticles({
    page,
    limit,
    categoryIds,
    archived: parseBoolean(query.archived),
    pinned: parseBoolean(query.pinned),
    search: (query.search ?? "").trim() || undefined,
    sort,
  });
  return handleResult(c, result);
});

wikiRoutes.get("/articles/:slug", async (c) => {
  const result = await getService(c).getArticleBySlug(c.req.param("slug"));
  return handleResult(c, result);
});

wikiRoutes.post("/articles", async (c) => {
  const sessionUser = await requireWikiArticlesCreate(c);
  const body = await parseJsonBody(c);
  const parsed = createWikiArticleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  const result = await getService(c).createArticle(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

wikiRoutes.patch("/articles/:id", async (c) => {
  const sessionUser = await requireWikiArticlesEdit(c);
  const body = await parseJsonBody(c);
  const parsed = updateWikiArticleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  const ifMatchHeader = c.req.header("If-Match");
  const conditionalEtag = ifMatchHeader && ifMatchHeader !== "*" ? ifMatchHeader : undefined;
  const result = await getService(c).updateArticle(sessionUser.id, c.req.param("id"), parsed.data, conditionalEtag);
  return handleResult(c, result);
});

// --- Revision routes (editor-only: history is a moderation tool) ---

wikiRoutes.get("/articles/:id/revisions", async (c) => {
  await requireWikiArticlesEdit(c);
  const result = await getService(c).listRevisions(c.req.param("id"));
  return handleResult(c, result);
});

wikiRoutes.get("/articles/:id/revisions/:revision", async (c) => {
  await requireWikiArticlesEdit(c);
  const revision = Number.parseInt(c.req.param("revision"), 10);
  if (!Number.isInteger(revision) || revision < 1) return buildError(c, "VALIDATION_ERROR", "Invalid revision number");
  const result = await getService(c).getRevision(c.req.param("id"), revision);
  return handleResult(c, result);
});

wikiRoutes.post("/articles/:id/revisions/:revision/restore", async (c) => {
  const sessionUser = await requireWikiArticlesEdit(c);
  const revision = Number.parseInt(c.req.param("revision"), 10);
  if (!Number.isInteger(revision) || revision < 1) return buildError(c, "VALIDATION_ERROR", "Invalid revision number");
  const result = await getService(c).restoreRevision(sessionUser.id, c.req.param("id"), revision);
  return handleResult(c, result);
});

wikiRoutes.delete("/articles/:id", async (c) => {
  const sessionUser = await requirePermission(c, "wiki.articles.archive");
  const result = await getService(c).archiveArticle(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

wikiRoutes.delete("/articles/:id/permanent", async (c) => {
  const sessionUser = await requirePermission(c, "wiki.articles.delete");
  const result = await getService(c).permanentDeleteArticle(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

wikiRoutes.post("/articles/:id/images", async (c) => {
  const sessionUser = await requireWikiArticlesEdit(c);

  const form = await safeFormData(c);
  let uploads;
  try {
    uploads = await parseImageMediaFormData(form);
  } catch (error) {
    if (error instanceof MediaValidationError) return buildError(c, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const mediaPolicy = await withMedia(c).getMediaPolicy();
  if (uploads.length > mediaPolicy.quotas.wiki) {
    return buildError(c, "VALIDATION_ERROR", `Maximum ${mediaPolicy.quotas.wiki} wiki images per upload`);
  }
  const result = await getService(c).uploadArticleImages(sessionUser.id, c.req.param("id"), uploads, mediaPolicy.quotas.wiki, mediaPolicy.max_file_size_bytes.wiki_image);
  return handleResult(c, result);
});
