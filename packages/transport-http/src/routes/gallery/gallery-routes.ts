import type { RequestContext } from "@guild/kernel";
import type { GalleryService } from "@guild/server/modules/gallery";
import { createGalleryItemSchema, updateGalleryItemSchema } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseFormData, parseImageUploads, parseJsonBody, parseQuery, parseValue, validation } from "../../core/parsing.js";
import {
  presentGalleryBatchDelete,
  presentGalleryItem,
  presentGalleryLike,
  presentGalleryOk,
  presentGalleryPage,
  presentGalleryUpload,
} from "../../presenters/gallery/gallery-presenter.js";

const instantSchema = z.string().datetime().transform((value) => new Date(value).toISOString());
const galleryQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["image", "video"]).optional(),
  date_from: instantSchema.optional(),
  date_to: instantSchema.optional(),
  search: z.string().trim().max(200).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict().superRefine((query, context) => {
  if (query.date_from && query.date_to && query.date_from > query.date_to) {
    context.addIssue({ code: "custom", path: ["date_to"], message: "Invalid gallery date range" });
  }
});
const titlesSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const descriptionsSchema = z.array(z.string().max(200)).max(50);
const batchDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Gallery ids must be unique"),
}).strict();

type GalleryHttpService = Pick<GalleryService, "list" | "uploadImages" | "createVideo" | "update" | "delete" | "batchDelete" | "like" | "unlike">;

export type GalleryImagePolicy = Readonly<{ maxBytes: number; quota: number }>;
export type GalleryRouteDependencies = Readonly<{
  service: GalleryHttpService;
  getImagePolicy(context: RequestContext): GalleryImagePolicy | Promise<GalleryImagePolicy>;
}>;

export function createGalleryRoutes(dependencies: GalleryRouteDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();

  routes.get("/", async (context) => {
    const request = requestContext(context);
    const query = parseQuery(context.req.raw, galleryQuerySchema, "Invalid gallery query");
    const result = await dependencies.service.list(request, {
      limit: query.limit,
      order: query.order,
      ...defined("cursor", query.cursor),
      ...defined("type", query.type),
      ...defined("dateFrom", query.date_from),
      ...defined("dateTo", query.date_to),
      ...defined("search", query.search?.toLowerCase() || undefined),
    });
    return jsonWithEtag(context.req.raw, presentGalleryPage(result));
  });

  routes.post("/images", async (context) => {
    const request = requestContext(context);
    request.authorization.require(PERMISSION_ID.GALLERY_UPLOAD);
    const form = await parseFormData(context.req.raw);
    const [uploads, policy] = await Promise.all([
      parseImageUploads(form),
      dependencies.getImagePolicy(request),
    ]);
    const titles = parseValue(form.getAll("titles"), titlesSchema, "Invalid gallery titles");
    const descriptions = parseValue(form.getAll("descriptions"), descriptionsSchema, "Invalid gallery descriptions");
    if (titles.length !== uploads.length || descriptions.length > uploads.length) {
      throw validation("Gallery metadata must align with images");
    }
    const metadata = uploads.map((_, index) => ({
      title: titles[index]!,
      description: descriptions[index]?.trim() || null,
    }));
    return context.json(presentGalleryUpload(await dependencies.service.uploadImages(
      request,
      uploads,
      metadata,
      policy.maxBytes,
      policy.quota,
    )), 201);
  });

  routes.post("/videos", async (context) => {
    const request = requestContext(context);
    const input = await parseJsonBody(context.req.raw, createGalleryItemSchema, "Invalid gallery video payload");
    return context.json(presentGalleryItem(await dependencies.service.createVideo(request, input)), 201);
  });

  routes.post("/batch-delete", async (context) => {
    const input = await parseJsonBody(context.req.raw, batchDeleteSchema, "Invalid gallery batch delete payload");
    return context.json(presentGalleryBatchDelete(
      await dependencies.service.batchDelete(requestContext(context), input.ids),
    ));
  });

  routes.patch("/:id", async (context) => {
    const input = await parseJsonBody(context.req.raw, updateGalleryItemSchema, "Invalid gallery update payload");
    return context.json(presentGalleryItem(await dependencies.service.update(
      requestContext(context),
      context.req.param("id"),
      input,
      requiredIfMatch(context.req.header("If-Match")),
    )));
  });

  routes.put("/:id/like", async (context) => context.json(presentGalleryLike(
    await dependencies.service.like(requestContext(context), context.req.param("id")),
  )));

  routes.delete("/:id/like", async (context) => context.json(presentGalleryLike(
    await dependencies.service.unlike(requestContext(context), context.req.param("id")),
  )));

  routes.delete("/:id", async (context) => context.json(presentGalleryOk(
    await dependencies.service.delete(
      requestContext(context),
      context.req.param("id"),
      requiredIfMatch(context.req.header("If-Match")),
    ),
  )));

  return routes;
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: V };
}

function requiredIfMatch(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "*") throw validation("If-Match header is required");
  return normalized;
}
