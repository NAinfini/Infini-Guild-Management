import type { RequestContext } from "@guild/kernel";
import type { GalleryService } from "@guild/server/modules/gallery";
import { createGalleryItemSchema } from "@guild/shared";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseFormData, parseImageUploads, parseJsonBody, parseQuery, parseValue, validation } from "../../core/parsing.js";
import {
  presentGalleryBatchDelete,
  presentGalleryItem,
  presentGalleryOk,
  presentGalleryPage,
  presentGalleryUpload,
} from "../../presenters/gallery/gallery-presenter.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDay, "Invalid calendar date");
const galleryQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["image", "video"]).optional(),
  date_from: daySchema.optional(),
  date_to: daySchema.optional(),
  search: z.string().trim().max(200).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
const captionsSchema = z.array(z.string().max(200)).max(50);
const batchDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Gallery ids must be unique"),
}).strict();

type GalleryHttpService = Pick<GalleryService, "list" | "uploadImages" | "createVideo" | "delete" | "batchDelete">;

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
      ...defined("dateFrom", query.date_from ? `${query.date_from}T00:00:00.000Z` : undefined),
      ...defined("dateTo", query.date_to ? `${query.date_to}T23:59:59.999Z` : undefined),
      ...defined("search", query.search?.toLowerCase() || undefined),
    });
    return jsonWithEtag(context.req.raw, presentGalleryPage(result));
  });

  routes.post("/images", async (context) => {
    const request = requestContext(context);
    const form = await parseFormData(context.req.raw);
    const [uploads, policy] = await Promise.all([
      parseImageUploads(form),
      dependencies.getImagePolicy(request),
    ]);
    const captions = parseValue(form.getAll("captions"), captionsSchema, "Invalid gallery captions");
    if (captions.length > uploads.length) throw validation("Gallery captions must align with images");
    const aligned = uploads.map((_, index) => captions[index]?.trim() || null);
    return context.json(presentGalleryUpload(await dependencies.service.uploadImages(
      request,
      uploads,
      aligned,
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

  routes.delete("/:id", async (context) => context.json(presentGalleryOk(
    await dependencies.service.delete(requestContext(context), context.req.param("id")),
  )));

  return routes;
}

function isCalendarDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: V };
}
