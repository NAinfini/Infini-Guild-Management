import {
  ALLOWED_IMAGE_TYPES,
  FILE_SIZE_LIMITS,
  createGalleryItemSchema,
} from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { GalleryService } from "../services/GalleryService";
import { validateUploadBytes } from "../services/media";
import { buildError, collectFiles, getDb, handleResult, parseJsonBody, requireSessionUser, safeFormData, serveR2Object } from "./_shared";
import { withMedia } from "./service-factory";

export const galleryRoutes = new Hono();

const GALLERY_CAPTION_MAX_LENGTH = 200;

function getService(c: Context): GalleryService {
  const env = c.env as Bindings;
  return new GalleryService(getDb(c), {
    ...withMedia(c),
    rawDb: env.DB,
  });
}

async function requireGalleryUploader(c: Context) { return requirePermission(c, "gallery.upload"); }

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDayStartIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseDayEndIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

// --- Routes ---

galleryRoutes.get("/image", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  if (!key.startsWith("gallery/")) return buildError(c, "FORBIDDEN", "Invalid gallery media key");

  return serveR2Object(c, key, "Gallery media not found");
});

galleryRoutes.get("/", async (c) => {
  const cursor = parsePositiveInt(c.req.query("cursor"), 0);
  const limit = Math.min(100, Math.max(1, parsePositiveInt(c.req.query("limit"), 20)));
  const typeFilter = c.req.query("type") as "image" | "video" | undefined;
  const dateFrom = parseDayStartIso(c.req.query("date_from"));
  const dateTo = parseDayEndIso(c.req.query("date_to"));
  const search = (c.req.query("search") ?? "").trim().toLowerCase();
  const order = c.req.query("order") === "asc" ? "asc" : "desc";
  const user = await getRequestUser(c);
  const result = await getService(c).listItems({ cursor, limit, type: typeFilter, dateFrom, dateTo, search: search || undefined, order, currentUserId: user?.id });
  return handleResult(c, result);
});

galleryRoutes.post("/images", async (c) => {
  const sessionUser = await requireGalleryUploader(c);

  const form = await safeFormData(c);
  const captionsRaw = form.getAll("captions");
  const files = collectFiles(form);

  if (files.length === 0) return buildError(c, "VALIDATION_ERROR", "No files provided");
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number])) return buildError(c, "VALIDATION_ERROR", `Invalid file type: ${file.name}`);
    if (file.size > FILE_SIZE_LIMITS.galleryImage) return buildError(c, "VALIDATION_ERROR", `File too large: ${file.name}`);
  }

  const captions = files.map((_, i) => { const raw = captionsRaw[i]; return typeof raw === "string" && raw.trim() ? raw.trim() : null; });
  if (captions.find((c) => c !== null && c.length > GALLERY_CAPTION_MAX_LENGTH)) return buildError(c, "VALIDATION_ERROR", `caption must be ${GALLERY_CAPTION_MAX_LENGTH} characters or less`);

  const allowedTypes = new Set<string>(ALLOWED_IMAGE_TYPES);
  const fileData: Array<{ data: ArrayBuffer; contentType: string; name: string }> = [];
  for (const file of files) {
    const data = await file.arrayBuffer();
    const validation = validateUploadBytes(data, file.type || "application/octet-stream", allowedTypes);
    if (!validation.ok) return buildError(c, "VALIDATION_ERROR", validation.message);
    fileData.push({ data, contentType: validation.contentType, name: file.name });
  }
  const result = await getService(c).uploadImages(sessionUser.id, fileData, captions);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json({ data: result.data }, 201);
});

galleryRoutes.post("/videos", async (c) => {
  const sessionUser = await requireGalleryUploader(c);
  const body = await parseJsonBody(c);
  const parsed = createGalleryItemSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid gallery video payload", parsed.error.flatten());
  if (parsed.data.type !== "video") return buildError(c, "VALIDATION_ERROR", "type must be video for this endpoint");
  const result = await getService(c).createVideo(sessionUser.id, parsed.data.url, parsed.data.caption ?? null);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

galleryRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireSessionUser(c);
  const result = await getService(c).deleteItem(sessionUser.id, sessionUser.permissions.has("gallery.delete"), c.req.param("id"));
  return handleResult(c, result);
});

galleryRoutes.post("/batch-delete", async (c) => {
  const sessionUser = await requirePermission(c, "gallery.delete", { freshPermissions: true });
  const body = await parseJsonBody(c);
  if (!body || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids)) return buildError(c, "VALIDATION_ERROR", "Body must contain an ids array");
  const ids = (body as { ids: string[] }).ids.filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return c.json({ ok: true, deleted: 0 });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch request");
  const result = await getService(c).batchDelete(sessionUser.id, ids);
  return handleResult(c, result);
});
