import {
  ERROR_STATUS,
  createGalleryCommentSchema,
  createGalleryItemSchema,
  galleryCommentSchema,
  galleryItemSchema,
  hasRoleAtLeast,
  updateGalleryCommentSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { galleryComments, galleryItems, galleryLikes, users } from "../db/schema";
import type { Bindings } from "../index";
import { resolveSession } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { deleteMediaObject } from "../services/media";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type GalleryRow = {
  id: string;
  type: string;
  url: string;
  caption: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  createdAt: string;
  likeCount?: number;
  commentCount?: number;
  isLiked?: boolean;
};

export const galleryRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseDayStartIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function parseDayEndIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toGalleryPayload(row: GalleryRow) {
  return galleryItemSchema.parse({
    id: row.id,
    type: row.type,
    url: row.url,
    caption: row.caption,
    uploaded_by: row.uploadedBy,
    uploaded_by_name: row.uploadedByName,
    like_count: row.likeCount ?? 0,
    comment_count: row.commentCount ?? 0,
    is_liked: row.isLiked ?? false,
    created_at: row.createdAt,
  });
}

async function getItemById(c: Context, itemId: string, currentUserId?: string): Promise<GalleryRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: galleryItems.id,
        type: galleryItems.type,
        url: galleryItems.url,
        caption: galleryItems.caption,
        uploadedBy: galleryItems.uploadedBy,
        uploadedByName: users.username,
        createdAt: galleryItems.createdAt,
        likeCount: sql<number>`(SELECT COUNT(*) FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id})`,
        commentCount: sql<number>`(SELECT COUNT(*) FROM gallery_comments WHERE gallery_item_id = ${galleryItems.id})`,
      })
      .from(galleryItems)
      .leftJoin(users, eq(users.id, galleryItems.uploadedBy))
      .where(eq(galleryItems.id, itemId))
      .limit(1)
  )[0];

  if (!row) return null;

  let isLiked = false;
  if (currentUserId) {
    const like = await db
      .select({ id: galleryLikes.id })
      .from(galleryLikes)
      .where(and(eq(galleryLikes.galleryItemId, itemId), eq(galleryLikes.userId, currentUserId)))
      .limit(1);
    isLiked = like.length > 0;
  }

  return { ...row, isLiked };
}

async function requireRole(c: Context, requiredRole: Role): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  if (!hasRoleAtLeast(resolved.user.role, requiredRole)) {
    return buildError(c, "FORBIDDEN", "Insufficient role");
  }
  return resolved.user;
}

galleryRoutes.get("/", async (c) => {
  const cursor = parsePositiveInt(c.req.query("cursor"), 0);
  const limit = Math.min(100, Math.max(1, parsePositiveInt(c.req.query("limit"), 20)));
  const typeFilter = c.req.query("type") as "image" | "video" | undefined;
  const dateFrom = parseDayStartIso(c.req.query("date_from"));
  const dateTo = parseDayEndIso(c.req.query("date_to"));
  const search = (c.req.query("search") ?? "").trim().toLowerCase();
  const order = c.req.query("order") === "asc" ? "asc" : "desc";

  // Resolve current user for is_liked check (optional, no auth required)
  const resolved = await resolveSession(c);
  const currentUserId = resolved?.user.id;

  const filters: SQL<unknown>[] = [];
  if (typeFilter) {
    filters.push(eq(galleryItems.type, typeFilter as typeof galleryItems.type.enumValues[number]));
  }
  if (dateFrom) {
    filters.push(gte(galleryItems.createdAt, dateFrom));
  }
  if (dateTo) {
    filters.push(lte(galleryItems.createdAt, dateTo));
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(
      or(
        sql`lower(coalesce(${galleryItems.caption}, '')) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(coalesce(${users.username}, '')) LIKE ${pattern} ESCAPE '\\'`,
      ) as SQL<unknown>,
    );
  }

  const whereClause = and(...filters);
  const db = getDb(c);
  const rows = await db
    .select({
      id: galleryItems.id,
      type: galleryItems.type,
      url: galleryItems.url,
      caption: galleryItems.caption,
      uploadedBy: galleryItems.uploadedBy,
      uploadedByName: users.username,
      createdAt: galleryItems.createdAt,
      likeCount: sql<number>`(SELECT COUNT(*) FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id})`,
      commentCount: sql<number>`(SELECT COUNT(*) FROM gallery_comments WHERE gallery_item_id = ${galleryItems.id})`,
      ...(currentUserId
        ? { isLiked: sql<boolean>`EXISTS(SELECT 1 FROM gallery_likes WHERE gallery_item_id = ${galleryItems.id} AND user_id = ${currentUserId})` }
        : {}),
    })
    .from(galleryItems)
    .leftJoin(users, eq(users.id, galleryItems.uploadedBy))
    .where(whereClause)
    .orderBy(
      order === "asc" ? asc(galleryItems.createdAt) : desc(galleryItems.createdAt),
      order === "asc" ? asc(galleryItems.id) : desc(galleryItems.id),
    )
    .limit(limit + 1)
    .offset(cursor);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    data: pageRows.map(toGalleryPayload),
    next_cursor: hasMore ? String(cursor + limit) : null,
  });
});

galleryRoutes.post("/images", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const form = await c.req.formData();
  const files: File[] = [];
  const captionsRaw = form.getAll("captions");
  const single = form.get("file");
  if (single instanceof File) {
    files.push(single);
  }
  for (const item of form.getAll("files")) {
    if (item instanceof File) {
      files.push(item);
    }
  }

  if (files.length === 0) {
    return buildError(c, "VALIDATION_ERROR", "No files provided");
  }

  const captions = files.map((_, index) => {
    const raw = captionsRaw[index];
    if (typeof raw !== "string") {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed;
  });
  const tooLongCaption = captions.find((caption) => caption !== null && caption.length > 200);
  if (tooLongCaption) {
    return buildError(c, "VALIDATION_ERROR", "caption must be 200 characters or less");
  }

  const env = c.env as Bindings;
  const db = getDb(c);
  const created: GalleryRow[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) {
      continue;
    }
    const caption = captions[index] ?? null;
    const itemId = nanoid();
    const key = `gallery/images/${sessionUser.id}/${Date.now()}_${itemId}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
    });

    await db.insert(galleryItems).values({
      id: itemId,
      type: "image",
      url: key,
      caption,
      uploadedBy: sessionUser.id,
    });

    created.push({
      id: itemId,
      type: "image",
      url: key,
      caption,
      uploadedBy: sessionUser.id,
      uploadedByName: null,
      createdAt: new Date().toISOString(),
    });
  }

  await writeAuditLog(c, {
    entityType: "gallery_item",
    action: "upload_images",
    actorId: sessionUser.id,
    entityId: "batch",
    detailText: JSON.stringify({
      count: created.length,
      captioned_count: created.filter((item) => Boolean(item.caption)).length,
    }),
  });

  return c.json({ data: created.map(toGalleryPayload) }, 201);
});

galleryRoutes.post("/videos", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createGalleryItemSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid gallery video payload", parsed.error.flatten());
  }
  if (parsed.data.type !== "video") {
    return buildError(c, "VALIDATION_ERROR", "type must be video for this endpoint");
  }

  const itemId = nanoid();
  const db = getDb(c);
  await db.insert(galleryItems).values({
    id: itemId,
    type: "video",
    url: parsed.data.url,
    caption: parsed.data.caption ?? null,
    uploadedBy: sessionUser.id,
  });

  const created = await getItemById(c, itemId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create gallery item");
  }

  await writeAuditLog(c, {
    entityType: "gallery_item",
    action: "create_video",
    actorId: sessionUser.id,
    entityId: itemId,
    diffTitle: parsed.data.caption ?? null,
  });

  return c.json(toGalleryPayload(created), 201);
});

galleryRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireRole(c, "moderator");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const itemId = c.req.param("id");
  const existing = await getItemById(c, itemId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Gallery item not found");
  }

  const db = getDb(c);
  await db.delete(galleryItems).where(eq(galleryItems.id, itemId));

  if (existing.type === "image") {
    await deleteMediaObject(c, existing.url);
  }

  await writeAuditLog(c, {
    entityType: "gallery_item",
    action: "delete",
    actorId: sessionUser.id,
    entityId: itemId,
    diffTitle: existing.caption,
  });

  return c.json({ ok: true });
});

// ── Like (one-way, no unlike) ───────────────────────────────────────

galleryRoutes.post("/:id/like", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const itemId = c.req.param("id");
  const existing = await getItemById(c, itemId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Gallery item not found");
  }

  const db = getDb(c);
  try {
    await db.insert(galleryLikes).values({
      id: nanoid(),
      galleryItemId: itemId,
      userId: sessionUser.id,
    });
  } catch (err: unknown) {
    // UNIQUE constraint violation = already liked
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      return c.json({ ok: true, already_liked: true });
    }
    throw err;
  }

  return c.json({ ok: true, already_liked: false }, 201);
});

// ── Comments ────────────────────────────────────────────────────────

galleryRoutes.get("/:id/comments", async (c) => {
  const itemId = c.req.param("id");
  const cursor = parsePositiveInt(c.req.query("cursor"), 0);
  const limit = Math.min(100, Math.max(1, parsePositiveInt(c.req.query("limit"), 50)));

  const db = getDb(c);

  // Verify item exists
  const item = await db.select({ id: galleryItems.id }).from(galleryItems).where(eq(galleryItems.id, itemId)).limit(1);
  if (item.length === 0) {
    return buildError(c, "NOT_FOUND", "Gallery item not found");
  }

  const rows = await db
    .select({
      id: galleryComments.id,
      galleryItemId: galleryComments.galleryItemId,
      userId: galleryComments.userId,
      username: users.username,
      body: galleryComments.body,
      createdAt: galleryComments.createdAt,
      updatedAt: galleryComments.updatedAt,
    })
    .from(galleryComments)
    .leftJoin(users, eq(users.id, galleryComments.userId))
    .where(eq(galleryComments.galleryItemId, itemId))
    .orderBy(asc(galleryComments.createdAt), asc(galleryComments.id))
    .limit(limit + 1)
    .offset(cursor);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    data: pageRows.map((row) =>
      galleryCommentSchema.parse({
        id: row.id,
        gallery_item_id: row.galleryItemId,
        user_id: row.userId,
        username: row.username,
        body: row.body,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      }),
    ),
    next_cursor: hasMore ? String(cursor + limit) : null,
  });
});

galleryRoutes.post("/:id/comments", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const itemId = c.req.param("id");
  const existing = await getItemById(c, itemId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Gallery item not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createGalleryCommentSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid comment", parsed.error.flatten());
  }

  const commentId = nanoid();
  const db = getDb(c);
  await db.insert(galleryComments).values({
    id: commentId,
    galleryItemId: itemId,
    userId: sessionUser.id,
    body: parsed.data.body,
  });

  const comment = (
    await db
      .select({
        id: galleryComments.id,
        galleryItemId: galleryComments.galleryItemId,
        userId: galleryComments.userId,
        username: users.username,
        body: galleryComments.body,
        createdAt: galleryComments.createdAt,
        updatedAt: galleryComments.updatedAt,
      })
      .from(galleryComments)
      .leftJoin(users, eq(users.id, galleryComments.userId))
      .where(eq(galleryComments.id, commentId))
      .limit(1)
  )[0];

  if (!comment) {
    return buildError(c, "SERVER_ERROR", "Failed to create comment");
  }

  await writeAuditLog(c, {
    entityType: "gallery_comment",
    action: "create",
    actorId: sessionUser.id,
    entityId: commentId,
    detailText: `on gallery item ${itemId}`,
  });

  return c.json(
    galleryCommentSchema.parse({
      id: comment.id,
      gallery_item_id: comment.galleryItemId,
      user_id: comment.userId,
      username: comment.username,
      body: comment.body,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    }),
    201,
  );
});

galleryRoutes.patch("/:id/comments/:commentId", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const commentId = c.req.param("commentId");
  const db = getDb(c);

  const existing = (
    await db
      .select({ id: galleryComments.id, userId: galleryComments.userId })
      .from(galleryComments)
      .where(eq(galleryComments.id, commentId))
      .limit(1)
  )[0];

  if (!existing) {
    return buildError(c, "NOT_FOUND", "Comment not found");
  }

  // Only the author can edit their own comment
  if (existing.userId !== sessionUser.id) {
    return buildError(c, "FORBIDDEN", "You can only edit your own comments");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateGalleryCommentSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid comment update", parsed.error.flatten());
  }

  const now = new Date().toISOString();
  await db
    .update(galleryComments)
    .set({ body: parsed.data.body, updatedAt: now })
    .where(eq(galleryComments.id, commentId));

  const updated = (
    await db
      .select({
        id: galleryComments.id,
        galleryItemId: galleryComments.galleryItemId,
        userId: galleryComments.userId,
        username: users.username,
        body: galleryComments.body,
        createdAt: galleryComments.createdAt,
        updatedAt: galleryComments.updatedAt,
      })
      .from(galleryComments)
      .leftJoin(users, eq(users.id, galleryComments.userId))
      .where(eq(galleryComments.id, commentId))
      .limit(1)
  )[0];

  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to update comment");
  }

  return c.json(
    galleryCommentSchema.parse({
      id: updated.id,
      gallery_item_id: updated.galleryItemId,
      user_id: updated.userId,
      username: updated.username,
      body: updated.body,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    }),
  );
});

galleryRoutes.delete("/:id/comments/:commentId", async (c) => {
  const sessionUser = await requireRole(c, "member");
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const commentId = c.req.param("commentId");
  const db = getDb(c);

  const existing = (
    await db
      .select({ id: galleryComments.id, userId: galleryComments.userId, galleryItemId: galleryComments.galleryItemId })
      .from(galleryComments)
      .where(eq(galleryComments.id, commentId))
      .limit(1)
  )[0];

  if (!existing) {
    return buildError(c, "NOT_FOUND", "Comment not found");
  }

  // Owner can delete own comment, mod+ can delete any
  if (existing.userId !== sessionUser.id && !hasRoleAtLeast(sessionUser.role, "moderator")) {
    return buildError(c, "FORBIDDEN", "Cannot delete this comment");
  }

  await db.delete(galleryComments).where(eq(galleryComments.id, commentId));

  await writeAuditLog(c, {
    entityType: "gallery_comment",
    action: "delete",
    actorId: sessionUser.id,
    entityId: commentId,
    detailText: `on gallery item ${existing.galleryItemId}`,
  });

  return c.json({ ok: true });
});
