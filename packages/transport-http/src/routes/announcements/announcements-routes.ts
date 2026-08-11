import type { RequestContext } from "@guild/kernel";
import type { AnnouncementService } from "@guild/server/modules/announcements";
import {
  createAnnouncementSchema,
  type Announcement,
  updateAnnouncementSchema,
} from "@guild/shared";
import { ANNOUNCEMENT_STATUSES } from "@guild/shared/constants/announcements";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import { parseFormData, parseIfMatch, parseImageUploads, parseJsonBody, parseQuery } from "../../core/parsing.js";
import {
  presentAnnouncement,
  presentAnnouncementMediaIds,
  presentAnnouncementOk,
  presentAnnouncementPage,
  presentAnnouncementPendingImages,
} from "../../presenters/announcements/announcements-presenter.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  pinned: booleanQuery.optional(),
  archived: booleanQuery.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["updated_desc", "updated_asc"]).default("updated_desc"),
});

type AnnouncementHttpService = Pick<AnnouncementService,
  "list" | "get" | "create" | "update" | "archive" | "delete" | "uploadPendingImages" | "uploadImages">;

export type AnnouncementImagePolicy = Readonly<{ maxBytes: number; quota: number }>;
export type AnnouncementRouteDependencies = Readonly<{
  service: AnnouncementHttpService;
  publicOrigin: string;
  getImagePolicy(context: RequestContext): AnnouncementImagePolicy | Promise<AnnouncementImagePolicy>;
}>;

export function createAnnouncementRoutes(dependencies: AnnouncementRouteDependencies): Hono<HttpEnv> {
  const routes = new Hono<HttpEnv>();
  const publicOrigin = resolvePublicOrigin(dependencies.publicOrigin);

  routes.get("/", async (context) => {
    const request = requestContext(context);
    const query = parseQuery(context.req.raw, listQuerySchema, "Invalid announcement query");
    const result = await dependencies.service.list(request, {
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      ...defined("status", query.status),
      ...defined("pinned", query.pinned),
      ...defined("archived", query.archived),
      ...defined("search", query.search || undefined),
    });
    return jsonWithEtag(context.req.raw, presentAnnouncementPage(result));
  });

  routes.post("/images", async (context) => {
    const request = requestContext(context);
    const [uploads, policy] = await Promise.all([
      parseFormData(context.req.raw).then(parseImageUploads),
      dependencies.getImagePolicy(request),
    ]);
    return context.json(presentAnnouncementPendingImages(
      await dependencies.service.uploadPendingImages(request, uploads, policy.maxBytes, policy.quota),
    ), 201);
  });

  routes.post("/", async (context) => {
    const request = requestContext(context);
    const [input, policy] = await Promise.all([
      parseJsonBody(context.req.raw, createAnnouncementSchema, "Invalid announcement payload"),
      dependencies.getImagePolicy(request),
    ]);
    return context.json(presentAnnouncement(
      await dependencies.service.create(request, input, publicOrigin, policy.quota),
    ), 201);
  });

  routes.get("/:id", async (context) => {
    const announcement = presentAnnouncement(
      await dependencies.service.get(requestContext(context), context.req.param("id")),
    );
    return jsonWithEtag(context.req.raw, announcement, announcementEtag(announcement));
  });

  routes.patch("/:id", async (context) => {
    const request = requestContext(context);
    const [input, policy] = await Promise.all([
      parseJsonBody(context.req.raw, updateAnnouncementSchema, "Invalid announcement payload"),
      dependencies.getImagePolicy(request),
    ]);
    return context.json(presentAnnouncement(await dependencies.service.update(
      request,
      context.req.param("id"),
      input,
      publicOrigin,
      policy.quota,
      parseIfMatch(context.req.header("If-Match")),
    )));
  });

  routes.delete("/:id/permanent", async (context) => context.json(presentAnnouncementOk(
    await dependencies.service.delete(requestContext(context), context.req.param("id")),
  )));

  routes.delete("/:id", async (context) => context.json(presentAnnouncementOk(
    await dependencies.service.archive(requestContext(context), context.req.param("id")),
  )));

  routes.post("/:id/images", async (context) => {
    const request = requestContext(context);
    const [uploads, policy] = await Promise.all([
      parseFormData(context.req.raw).then(parseImageUploads),
      dependencies.getImagePolicy(request),
    ]);
    return context.json(presentAnnouncementMediaIds(await dependencies.service.uploadImages(
      request,
      context.req.param("id"),
      uploads,
      policy.maxBytes,
      policy.quota,
    )));
  });

  return routes;
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: V };
}

function announcementEtag(value: Pick<Announcement, "id" | "updated_at">): string {
  return `"announcement-${value.id}-${value.updated_at}"`;
}

function resolvePublicOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Announcement publicOrigin must be an HTTP origin");
  }
  return url.origin;
}
