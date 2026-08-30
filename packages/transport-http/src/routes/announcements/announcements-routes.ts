import type { RequestContext } from "@guild/kernel";
import type { AnnouncementService } from "@guild/server/modules/announcements";
import {
  announcementEtag,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "@guild/shared";
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES } from "@guild/shared/constants/announcements";
import { MAX_OFFSET_PAGE } from "@guild/shared/config/limits";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { z } from "zod";
import { jsonWithEtag } from "../../core/etag.js";
import type { HttpEnv } from "../../core/http-env.js";
import { requestContext } from "../../core/http-env.js";
import {
  parseAnnouncementAttachment,
  parseFormData,
  parseIfMatch,
  parseImageUploads,
  parseJsonBody,
  parseQuery,
  validation,
} from "../../core/parsing.js";
import {
  presentAnnouncement,
  presentAnnouncementOk,
  presentAnnouncementPage,
  presentAnnouncementViewCount,
  presentAnnouncementPendingAttachment,
  presentAnnouncementPendingImages,
} from "../../presenters/announcements/announcements-presenter.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_OFFSET_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
  pinned: booleanQuery.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["updated_desc", "updated_asc"]).default("updated_desc"),
});

type AnnouncementHttpService = Pick<AnnouncementService,
  "list" | "get" | "recordView" | "create" | "update" | "archive" | "delete" | "uploadPendingImages" | "uploadPendingAttachment">;

export type AnnouncementMediaPolicy = Readonly<{
  imageMaxBytes: number;
  imageQuota: number;
  attachmentMaxBytes: number;
  attachmentQuota: number;
}>;
export type AnnouncementRouteDependencies = Readonly<{
  service: AnnouncementHttpService;
  publicOrigin: string;
  getMediaPolicy(context: RequestContext): AnnouncementMediaPolicy | Promise<AnnouncementMediaPolicy>;
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
      ...defined("category", query.category),
      ...defined("pinned", query.pinned),
      ...defined("search", query.search || undefined),
    });
    return jsonWithEtag(context.req.raw, presentAnnouncementPage(result));
  });

  routes.post("/images", async (context) => {
    const request = requestContext(context);
    requireAnnouncementMediaUpload(request);
    const [uploads, policy] = await Promise.all([
      parseFormData(context.req.raw).then(parseImageUploads),
      dependencies.getMediaPolicy(request),
    ]);
    return context.json(presentAnnouncementPendingImages(
      await dependencies.service.uploadPendingImages(request, uploads, policy.imageMaxBytes, policy.imageQuota),
    ), 201);
  });

  routes.post("/attachments", async (context) => {
    const request = requestContext(context);
    requireAnnouncementMediaUpload(request);
    const [upload, policy] = await Promise.all([
      parseFormData(context.req.raw).then(parseAnnouncementAttachment),
      dependencies.getMediaPolicy(request),
    ]);
    return context.json(presentAnnouncementPendingAttachment(
      await dependencies.service.uploadPendingAttachment(
        request,
        upload,
        policy.attachmentMaxBytes,
        policy.attachmentQuota,
      ),
    ), 201);
  });

  routes.post("/", async (context) => {
    const request = requestContext(context);
    const [input, policy] = await Promise.all([
      parseJsonBody(context.req.raw, createAnnouncementSchema, "Invalid announcement payload"),
      dependencies.getMediaPolicy(request),
    ]);
    return context.json(presentAnnouncement(
      await dependencies.service.create(request, input, publicOrigin, policy.imageQuota, policy.attachmentQuota),
    ), 201);
  });

  routes.get("/:id", async (context) => {
    const announcement = presentAnnouncement(
      await dependencies.service.get(requestContext(context), context.req.param("id")),
    );
    return jsonWithEtag(context.req.raw, announcement, announcementEtag(announcement));
  });

  routes.post("/:id/view", async (context) => context.json(presentAnnouncementViewCount(
    await dependencies.service.recordView(requestContext(context), context.req.param("id")),
  )));

  routes.patch("/:id", async (context) => {
    const request = requestContext(context);
    const [input, policy] = await Promise.all([
      parseJsonBody(context.req.raw, updateAnnouncementSchema, "Invalid announcement payload"),
      dependencies.getMediaPolicy(request),
    ]);
    return context.json(presentAnnouncement(await dependencies.service.update(
      request,
      context.req.param("id"),
      input,
      publicOrigin,
      policy.imageQuota,
      policy.attachmentQuota,
      requiredIfMatch(context.req.header("If-Match")),
    )));
  });

  routes.delete("/:id/permanent", async (context) => context.json(presentAnnouncementOk(
    await dependencies.service.delete(
      requestContext(context),
      context.req.param("id"),
      requiredIfMatch(context.req.header("If-Match")),
    ),
  )));

  routes.delete("/:id", async (context) => context.json(presentAnnouncementOk(
    await dependencies.service.archive(
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

function requireAnnouncementMediaUpload(request: RequestContext): void {
  request.authorization.requireAuthenticated();
  if (!request.authorization.has(PERMISSION_ID.ANNOUNCEMENTS_CREATE)) {
    request.authorization.require(PERMISSION_ID.ANNOUNCEMENTS_EDIT);
  }
}

function resolvePublicOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new TypeError("Announcement publicOrigin must be an HTTP origin");
  }
  return url.origin;
}

function requiredIfMatch(value: string | undefined): string {
  const ifMatch = parseIfMatch(value);
  if (!ifMatch) throw validation("Announcement revision is required");
  return ifMatch;
}
