import {
  ALLOWED_IMAGE_TYPES,
  createAnnouncementSchema,
  hasAnyPermission,
  updateAnnouncementSchema,
} from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { AnnouncementService } from "../services/AnnouncementService";
import { AnnouncementImageStagingService } from "../services/announcement-image-staging";
import { validateUploadBytes } from "../services/media";
import { buildError, collectFiles, getDb, handleResult, parseBoolean, parseJsonBody, parsePage, safeFormData, serveR2Object } from "./_shared";
import { hasMediaQuotaCapacity, withMediaAndPublishAnnouncement } from "./service-factory";

export const announcementsRoutes = new Hono();

function getService(c: Context): AnnouncementService {
  return new AnnouncementService(getDb(c), withMediaAndPublishAnnouncement(c));
}

function getStagingService(c: Context): AnnouncementImageStagingService {
  const deps = withMediaAndPublishAnnouncement(c);
  return new AnnouncementImageStagingService({ media: deps.media, rawDb: deps.rawDb, signingSecret: deps.signingSecret });
}

async function requireAnnouncementCreate(c: Context) { return requirePermission(c, "announcements.create"); }
async function requireAnnouncementEdit(c: Context) { return requirePermission(c, "announcements.edit"); }

// --- Routes ---

announcementsRoutes.get("/", async (c) => {
  const user = await getRequestUser(c);
  const canReadAll = user ? hasAnyPermission(user.permissions, ["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"]) : false;
  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const result = await getService(c).list({ canReadAll, page, limit, status: query.status, pinned: parseBoolean(query.pinned), archived: parseBoolean(query.archived), search: (query.search ?? "").trim() || undefined });
  return handleResult(c, result);
});

announcementsRoutes.get("/image", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  if (!key.startsWith("announcement/")) return buildError(c, "FORBIDDEN", "Invalid announcement image key");
  return serveR2Object(c, key, "Announcement image not found");
});

announcementsRoutes.get("/:id", async (c) => {
  const user = await getRequestUser(c);
  const canReadAll = user ? hasAnyPermission(user.permissions, ["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"]) : false;
  const result = await getService(c).getOne(c.req.param("id"), canReadAll);
  return handleResult(c, result);
});

announcementsRoutes.post("/", async (c) => {
  const sessionUser = await requireAnnouncementCreate(c);
  const body = await parseJsonBody(c);
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  const result = await getService(c).create(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

announcementsRoutes.post("/images/stage", async (c) => {
  const sessionUser = await requireAnnouncementCreate(c);
  const form = await safeFormData(c);
  const files = collectFiles(form);
  if (files.length === 0) return buildError(c, "VALIDATION_ERROR", "No files provided");
  const mediaPolicy = await withMediaAndPublishAnnouncement(c).getMediaPolicy();
  if (files.length > mediaPolicy.quotas.announcement) {
    return buildError(c, "VALIDATION_ERROR", `Maximum ${mediaPolicy.quotas.announcement} announcement images per upload`);
  }
  const allowedTypes = new Set<string>(ALLOWED_IMAGE_TYPES);
  const fileData: Array<{ data: ArrayBuffer; contentType: string }> = [];
  for (const file of files) {
    if (file.size > mediaPolicy.max_file_size_bytes.announcement_image) return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
    const data = await file.arrayBuffer();
    const validation = validateUploadBytes(data, file.type || "application/octet-stream", allowedTypes);
    if (!validation.ok) return buildError(c, "VALIDATION_ERROR", validation.message);
    fileData.push({ data, contentType: validation.contentType });
  }
  const token = form.get("staging_token");
  const result = await getStagingService(c).stage(sessionUser.id, fileData, typeof token === "string" ? token : undefined, mediaPolicy.quotas.announcement);
  return handleResult(c, result, 201);
});

announcementsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireAnnouncementEdit(c);
  const body = await parseJsonBody(c);
  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  const ifMatchHeader = c.req.header("If-Match");
  const conditionalEtag = ifMatchHeader && ifMatchHeader !== "*" ? ifMatchHeader : undefined;
  const result = await getService(c).update(sessionUser.id, c.req.param("id"), parsed.data, conditionalEtag);
  return handleResult(c, result);
});

announcementsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requirePermission(c, "announcements.archive");
  const result = await getService(c).archive(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

announcementsRoutes.delete("/:id/permanent", async (c) => {
  const sessionUser = await requirePermission(c, "announcements.delete", { freshPermissions: true });
  const result = await getService(c).permanentDelete(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

announcementsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireAnnouncementEdit(c);

  const form = await safeFormData(c);
  const files = collectFiles(form);

  if (files.length === 0) return buildError(c, "VALIDATION_ERROR", "No files provided");
  const mediaPolicy = await withMediaAndPublishAnnouncement(c).getMediaPolicy();
  if (files.length > mediaPolicy.quotas.announcement) {
    return buildError(c, "VALIDATION_ERROR", `Maximum ${mediaPolicy.quotas.announcement} announcement images per upload`);
  }
  /* 和 /images/stage 同一档：声明的 Content-Type 只作初筛，最终以字节头为准。 */
  const allowedTypes = new Set<string>(ALLOWED_IMAGE_TYPES);
  const fileData: Array<{ data: ArrayBuffer; contentType: string }> = [];
  for (const file of files) {
    if (file.size > mediaPolicy.max_file_size_bytes.announcement_image) return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
    const data = await file.arrayBuffer();
    const validation = validateUploadBytes(data, file.type || "application/octet-stream", allowedTypes);
    if (!validation.ok) return buildError(c, "VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    fileData.push({ data, contentType: validation.contentType });
  }
  if (!await hasMediaQuotaCapacity(
    c,
    `announcement/${c.req.param("id")}/images/`,
    files.length,
    mediaPolicy.quotas.announcement,
  )) {
    return buildError(c, "VALIDATION_ERROR", `Announcement image quota is ${mediaPolicy.quotas.announcement}`);
  }

  const result = await getService(c).uploadImages(sessionUser.id, c.req.param("id"), fileData);
  return handleResult(c, result);
});
