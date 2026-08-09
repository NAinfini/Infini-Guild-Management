import {
  createAnnouncementSchema,
  hasAnyPermission,
  updateAnnouncementSchema,
} from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { AnnouncementService, type AnnouncementSort } from "../services/AnnouncementService";
import { MediaValidationError, parseImageMediaFormData } from "../services/MediaService";
import { buildError, getDb, handleResult, parseBoolean, parseJsonBody, parsePage, safeFormData } from "./_shared";
import { withMediaAndPublishAnnouncement } from "./service-factory";

export const announcementsRoutes = new Hono();

function parseAnnouncementSort(value: string | undefined): AnnouncementSort | null {
  if (value === undefined) return "updated_desc";
  return value === "updated_desc" || value === "updated_asc" ? value : null;
}

function getService(c: Context): AnnouncementService {
  return new AnnouncementService(getDb(c), withMediaAndPublishAnnouncement(c));
}

async function requireAnnouncementCreate(c: Context) { return requirePermission(c, "announcements.create"); }
async function requireAnnouncementEdit(c: Context) { return requirePermission(c, "announcements.edit"); }

// --- Routes ---

announcementsRoutes.get("/", async (c) => {
  const user = await getRequestUser(c);
  const canReadAll = user ? hasAnyPermission(user.permissions, ["announcements.create", "announcements.edit", "announcements.archive", "announcements.delete"]) : false;
  const query = c.req.query();
  const sort = parseAnnouncementSort(query.sort);
  if (!sort) return buildError(c, "VALIDATION_ERROR", "Invalid announcement sort");
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const result = await getService(c).list({ canReadAll, page, limit, status: query.status, pinned: parseBoolean(query.pinned), archived: parseBoolean(query.archived), search: (query.search ?? "").trim() || undefined, sort });
  return handleResult(c, result);
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

announcementsRoutes.post("/images", async (c) => {
  const sessionUser = await requireAnnouncementCreate(c);
  const form = await safeFormData(c);
  let uploads;
  try {
    uploads = await parseImageMediaFormData(form);
  } catch (error) {
    if (error instanceof MediaValidationError) return buildError(c, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const mediaPolicy = await withMediaAndPublishAnnouncement(c).getMediaPolicy();
  if (uploads.length > mediaPolicy.quotas.announcement) {
    return buildError(c, "VALIDATION_ERROR", `Maximum ${mediaPolicy.quotas.announcement} announcement images per upload`);
  }
  const result = await getService(c).createPendingImages(sessionUser.id, uploads, mediaPolicy.quotas.announcement, mediaPolicy.max_file_size_bytes.announcement_image);
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
  const sessionUser = await requirePermission(c, "announcements.delete");
  const result = await getService(c).permanentDelete(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

announcementsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireAnnouncementEdit(c);

  const form = await safeFormData(c);
  let uploads;
  try {
    uploads = await parseImageMediaFormData(form);
  } catch (error) {
    if (error instanceof MediaValidationError) return buildError(c, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const mediaPolicy = await withMediaAndPublishAnnouncement(c).getMediaPolicy();
  if (uploads.length > mediaPolicy.quotas.announcement) {
    return buildError(c, "VALIDATION_ERROR", `Maximum ${mediaPolicy.quotas.announcement} announcement images per upload`);
  }
  const result = await getService(c).uploadImages(sessionUser.id, c.req.param("id"), uploads, mediaPolicy.quotas.announcement, mediaPolicy.max_file_size_bytes.announcement_image);
  return handleResult(c, result);
});
