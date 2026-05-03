import {
  ALLOWED_IMAGE_TYPES,
  FILE_SIZE_LIMITS,
  createWikiArticleSchema,
  createWikiCategorySchema,
  updateWikiCategorySchema,
  updateWikiArticleSchema,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { WikiService } from "../services/WikiService";
import { buildError, handleResult, parseBoolean, parsePage } from "./_shared";

export const wikiRoutes = new Hono();

function getService(c: Context): WikiService {
  const env = c.env as Bindings;
  return new WikiService(drizzle(env.DB), {
    media: env.MEDIA,
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
  });
}

async function requireWikiArticlesCreate(c: Context) { return requirePermission(c, "wiki.articles.create"); }
async function requireWikiArticlesEdit(c: Context) { return requirePermission(c, "wiki.articles.edit"); }
async function requireWikiArticlesArchive(c: Context) { return requirePermission(c, "wiki.articles.archive"); }
async function requireWikiCategoriesManage(c: Context) { return requirePermission(c, "wiki.categories.manage"); }

// --- Category routes ---

wikiRoutes.get("/categories", async (c) => {
  const result = await getService(c).listCategories();
  return handleResult(c, result);
});

wikiRoutes.post("/categories", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = createWikiCategorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  const result = await getService(c).createCategory(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

wikiRoutes.patch("/categories/:id", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateWikiCategorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki category payload", parsed.error.flatten());
  const result = await getService(c).updateCategory(sessionUser.id, c.req.param("id"), parsed.data);
  return handleResult(c, result);
});

wikiRoutes.delete("/categories/:id", async (c) => {
  const sessionUser = await requireWikiCategoriesManage(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).deleteCategory(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

// --- Article routes ---

wikiRoutes.get("/articles", async (c) => {
  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const result = await getService(c).listArticles({ page, limit, categoryId: query.category_id, archived: parseBoolean(query.archived), search: (query.search ?? "").trim() || undefined });
  return handleResult(c, result);
});

wikiRoutes.get("/articles/:slug", async (c) => {
  const result = await getService(c).getArticleBySlug(c.req.param("slug"));
  return handleResult(c, result);
});

wikiRoutes.post("/articles", async (c) => {
  const sessionUser = await requireWikiArticlesCreate(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = createWikiArticleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  const result = await getService(c).createArticle(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

wikiRoutes.patch("/articles/:id", async (c) => {
  const sessionUser = await requireWikiArticlesEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateWikiArticleSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid wiki article payload", parsed.error.flatten());
  const ifMatchHeader = c.req.header("If-Match");
  const conditionalEtag = ifMatchHeader && ifMatchHeader !== "*" ? ifMatchHeader : undefined;
  const result = await getService(c).updateArticle(sessionUser.id, c.req.param("id"), parsed.data, conditionalEtag);
  return handleResult(c, result);
});

wikiRoutes.delete("/articles/:id", async (c) => {
  const sessionUser = await requireWikiArticlesArchive(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).archiveArticle(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

wikiRoutes.post("/articles/:id/images", async (c) => {
  const sessionUser = await requireWikiArticlesEdit(c);
  if (sessionUser instanceof Response) return sessionUser;

  const form = await c.req.formData();
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  for (const item of form.getAll("files")) { if (item instanceof File) files.push(item); }

  if (files.length === 0) return buildError(c, "VALIDATION_ERROR", "No files provided");
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number])) return buildError(c, "VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    if (file.size > FILE_SIZE_LIMITS.wikiImage) return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
  }

  const fileData = await Promise.all(files.map(async (f) => ({ data: await f.arrayBuffer(), contentType: f.type || "application/octet-stream" })));
  const result = await getService(c).uploadArticleImages(sessionUser.id, c.req.param("id"), fileData);
  return handleResult(c, result);
});
