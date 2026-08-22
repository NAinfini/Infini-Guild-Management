import type { RequestContext } from "@guild/kernel";
import { wikiArticleEtag, type WikiService } from "@guild/server/modules/wiki";
import {
  batchUpdateWikiCategoriesSchema,
  createWikiArticleSchema,
  createWikiCategorySchema,
  updateWikiArticleSchema,
  updateWikiCategorySchema,
  wikiRevisionListQuerySchema,
} from "@guild/shared";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseFormData, parseIfMatch, parseImageUploads, parseJsonBody, parseQuery, validation } from "../../core/parsing.js";
import {
  presentWikiArticle,
  presentWikiArticlePage,
  presentWikiCategories,
  presentWikiCategory,
  presentWikiMediaIds,
  presentWikiOk,
  presentWikiRevision,
  presentWikiRevisions,
} from "../../presenters/wiki/wiki-presenter.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const articleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category_id: z.union([z.string(), z.array(z.string())]).optional(),
  archived: booleanQuery.optional(),
  pinned: booleanQuery.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["curated", "updated_desc", "updated_asc"]).default("curated"),
});
const revisionSchema = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .refine(Number.isSafeInteger, "Invalid revision number");

type WikiHttpService = Pick<WikiService,
  "listCategories" | "createCategory" | "updateCategory" | "batchUpdateCategories" | "deleteCategory"
  | "listArticles" | "getArticleBySlug" | "createArticle" | "updateArticle" | "archiveArticle"
  | "deleteArticle" | "listRevisions" | "getRevision" | "restoreRevision" | "uploadArticleImages">;

export type WikiImagePolicy = Readonly<{ maxBytes: number; quota: number }>;
export type WikiRouteDependencies = Readonly<{
  service: WikiHttpService;
  publicOrigin: string;
  getImagePolicy(context: RequestContext): WikiImagePolicy | Promise<WikiImagePolicy>;
}>;

export function createWikiRoutes(dependencies: WikiRouteDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  const publicOrigin = resolvePublicOrigin(dependencies.publicOrigin);

  routes.get("/categories", async (context) => {
    requestContext(context);
    return jsonWithEtag(context.req.raw, presentWikiCategories(await dependencies.service.listCategories()));
  });

  routes.post("/categories", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, createWikiCategorySchema, "Invalid wiki category payload");
    return context.json(presentWikiCategory(await dependencies.service.createCategory(request, input)), 201);
  });

  routes.patch("/categories/batch", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, batchUpdateWikiCategoriesSchema, "Invalid wiki category batch payload");
    return context.json(presentWikiCategories(await dependencies.service.batchUpdateCategories(request, input.updates)));
  });

  routes.patch("/categories/:id", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, updateWikiCategorySchema, "Invalid wiki category payload");
    return context.json(presentWikiCategory(
      await dependencies.service.updateCategory(request, context.req.param("id"), input),
    ));
  });

  routes.delete("/categories/:id", async (context) => context.json(presentWikiOk(
    await dependencies.service.deleteCategory(requestContext(context), context.req.param("id")),
  )));

  routes.get("/articles", async (context) => {
    const request = requestContext(context);
    const query = parseQuery(context.req.raw, articleQuerySchema, "Invalid wiki article query");
    const categoryIds = normalizeCategoryIds(query.category_id);
    const page = await dependencies.service.listArticles(request, {
      page: query.page,
      limit: query.limit,
      categoryIds,
      sort: query.sort,
      ...defined("archived", query.archived),
      ...defined("pinned", query.pinned),
      ...defined("search", query.search || undefined),
    });
    return jsonWithEtag(context.req.raw, presentWikiArticlePage(page));
  });

  routes.post("/articles", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, createWikiArticleSchema, "Invalid wiki article payload");
    return context.json(presentWikiArticle(
      await dependencies.service.createArticle(request, input, publicOrigin),
    ), 201);
  });

  routes.get("/articles/:id/revisions", async (context) => {
    const query = parseQuery(context.req.raw, wikiRevisionListQuerySchema, "Invalid wiki revision query");
    return jsonWithEtag(context.req.raw, presentWikiRevisions(
      await dependencies.service.listRevisions(requestContext(context), context.req.param("id"), {
        limit: query.limit,
        ...defined("beforeRevision", query.before_revision),
      }),
    ));
  });

  routes.get("/articles/:id/revisions/:revision", async (context) => {
    const articleId = context.req.param("id");
    const revision = parseRevision(context.req.param("revision"));
    // 修订一经写入不可变，(文章, 修订号) 即是稳定的强 ETag，无需哈希大正文。
    return jsonWithEtag(
      context.req.raw,
      presentWikiRevision(await dependencies.service.getRevision(requestContext(context), articleId, revision)),
      `"wiki-revision-${articleId}-${revision}"`,
    );
  });

  routes.post("/articles/:id/revisions/:revision/restore", async (context) => context.json(presentWikiArticle(
    await dependencies.service.restoreRevision(
      requestContext(context),
      context.req.param("id"),
      parseRevision(context.req.param("revision")),
    ),
  )));

  routes.post("/articles/:id/images", async (context) => {
    const request = requestContext(context);
    const [uploads, policy] = await Promise.all([
      parseFormData(context.req.raw).then(parseImageUploads),
      dependencies.getImagePolicy(request),
    ]);
    return context.json(presentWikiMediaIds(await dependencies.service.uploadArticleImages(
      request,
      context.req.param("id"),
      uploads,
      policy.quota,
      policy.maxBytes,
    )));
  });

  routes.patch("/articles/:id", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, updateWikiArticleSchema, "Invalid wiki article payload");
    return context.json(presentWikiArticle(await dependencies.service.updateArticle(
      request,
      context.req.param("id"),
      input,
      publicOrigin,
      parseIfMatch(context.req.header("If-Match")),
    )));
  });

  routes.delete("/articles/:id/permanent", async (context) => context.json(presentWikiOk(
    await dependencies.service.deleteArticle(requestContext(context), context.req.param("id")),
  )));

  routes.delete("/articles/:id", async (context) => context.json(presentWikiOk(
    await dependencies.service.archiveArticle(requestContext(context), context.req.param("id")),
  )));

  routes.get("/articles/:slug", async (context) => {
    const article = presentWikiArticle(
      await dependencies.service.getArticleBySlug(requestContext(context), context.req.param("slug")),
    );
    return jsonWithEtag(context.req.raw, article, wikiArticleEtag(article));
  });

  return routes;
}

function normalizeCategoryIds(value: string | string[] | undefined): readonly string[] {
  const ids = [...new Set((value === undefined ? [] : Array.isArray(value) ? value : [value])
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean))];
  if (ids.length > 100) throw validation("Maximum 100 category_id values");
  return ids;
}

function parseRevision(value: string): number {
  const parsed = revisionSchema.safeParse(value);
  if (!parsed.success) throw validation("Invalid revision number", parsed.error.flatten());
  return parsed.data;
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: V };
}

function resolvePublicOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Wiki publicOrigin must be an HTTP origin");
  }
  return url.origin;
}
