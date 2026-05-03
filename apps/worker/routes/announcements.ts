import {
  ALLOWED_IMAGE_TYPES,
  FILE_SIZE_LIMITS,
  createAnnouncementSchema,
  hasAnyPermission,
  updateAnnouncementSchema,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";
import { AnnouncementService } from "../services/AnnouncementService";
import { buildError, handleResult, parseBoolean, parsePage } from "./_shared";

export const announcementsRoutes = new Hono();

function getService(c: Context): AnnouncementService {
  const env = c.env as Bindings;
  return new AnnouncementService(drizzle(env.DB), {
    media: env.MEDIA,
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (input) => publishEntityChanged(c, input),
    publishAnnouncementPublished: (input) => publishAnnouncementPublished(c, input),
  });
}

async function requireAnnouncementCreate(c: Context) { return requirePermission(c, "announcements.create"); }
async function requireAnnouncementEdit(c: Context) { return requirePermission(c, "announcements.edit"); }
async function requireAnnouncementArchive(c: Context) { return requirePermission(c, "announcements.archive"); }

// --- Routes ---

announcementsRoutes.get("/", async (c) => {
  const user = await getRequestUser(c);
  const canReadAll = user ? hasAnyPermission(user.permissions, ["announcements.create", "announcements.edit", "announcements.archive"]) : false;
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

  const object = await (c.env as Bindings).MEDIA.get(key);
  if (!object?.body) return buildError(c, "NOT_FOUND", "Announcement image not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});

announcementsRoutes.get("/:id", async (c) => {
  const user = await getRequestUser(c);
  const canReadAll = user ? hasAnyPermission(user.permissions, ["announcements.create", "announcements.edit", "announcements.archive"]) : false;
  const result = await getService(c).getOne(c.req.param("id"), canReadAll);
  return handleResult(c, result);
});

announcementsRoutes.post("/", async (c) => {
  const sessionUser = await requireAnnouncementCreate(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  const result = await getService(c).create(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

announcementsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireAnnouncementEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  const ifMatchHeader = c.req.header("If-Match");
  const conditionalEtag = ifMatchHeader && ifMatchHeader !== "*" ? ifMatchHeader : undefined;
  const result = await getService(c).update(sessionUser.id, c.req.param("id"), parsed.data, conditionalEtag);
  return handleResult(c, result);
});

announcementsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireAnnouncementArchive(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getService(c).archive(sessionUser.id, c.req.param("id"));
  return handleResult(c, result);
});

announcementsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireAnnouncementEdit(c);
  if (sessionUser instanceof Response) return sessionUser;

  const form = await c.req.formData();
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  for (const item of form.getAll("files")) { if (item instanceof File) files.push(item); }

  if (files.length === 0) return buildError(c, "VALIDATION_ERROR", "No files provided");
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number])) return buildError(c, "VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    if (file.size > FILE_SIZE_LIMITS.announcementImage) return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
  }

  const fileData = await Promise.all(files.map(async (f) => ({ data: await f.arrayBuffer(), contentType: f.type || "application/octet-stream" })));
  const result = await getService(c).uploadImages(sessionUser.id, c.req.param("id"), fileData);
  return handleResult(c, result);
});
