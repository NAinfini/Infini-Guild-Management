import {
  ERROR_STATUS,
  announcementSchema,
  createAnnouncementSchema,
  hasRoleAtLeast,
  updateAnnouncementSchema,
  type ErrorCode,
  type Role,
  type StandardErrorResponse,
} from "@guild/shared";
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { announcements } from "../db/schema";
import type { Bindings } from "../index";
import { resolveSession } from "../services/auth";
import { writeAuditLog } from "../services/audit";
import { createBotTask } from "../services/bot-dispatch";
import { publishAnnouncementPublished, publishEntityChanged } from "../services/push";

type SessionUser = { id: string; role: Role };
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

type AnnouncementRow = {
  id: string;
  title: string;
  bodyJson: string;
  pinned: boolean;
  pinnedAt: string | null;
  status: string;
  publishAt: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export const announcementsRoutes = new Hono();

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

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toAnnouncementPayload(row: AnnouncementRow) {
  return announcementSchema.parse({
    id: row.id,
    title: row.title,
    body_json: row.bodyJson,
    pinned: row.pinned,
    pinned_at: row.pinnedAt,
    status: row.status,
    publish_at: row.publishAt,
    expires_at: row.expiresAt,
    archived_at: row.archivedAt,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

async function dispatchAnnouncementNotifications(
  c: Context,
  payload: {
    id: string;
    title: string;
    bodyJson: string;
    publishAt: string | null;
    notifyDiscord: boolean;
    notifyWechat: boolean;
  },
) {
  const env = c.env as Bindings;
  const messagePayload = {
    announcement_id: payload.id,
    title: payload.title,
    body_json: payload.bodyJson,
    publish_at: payload.publishAt,
  };

  if (payload.notifyDiscord) {
    await createBotTask(env, {
      platform: "discord",
      taskType: "event_notify",
      targetId: "announcement:discord:broadcast",
      idempotencyKey: `announcement-manual:discord:${payload.id}:${Date.now()}`,
      payload: messagePayload,
      dispatchNow: true,
    });
  }
  if (payload.notifyWechat) {
    await createBotTask(env, {
      platform: "wechat",
      taskType: "event_notify",
      targetId: "announcement:wechat:broadcast",
      idempotencyKey: `announcement-manual:wechat:${payload.id}:${Date.now()}`,
      payload: messagePayload,
      dispatchNow: true,
    });
  }
}

async function getAnnouncementById(c: Context, announcementId: string): Promise<AnnouncementRow | null> {
  const db = getDb(c);
  const row = (
    await db
      .select({
        id: announcements.id,
        title: announcements.title,
        bodyJson: announcements.bodyJson,
        pinned: announcements.pinned,
        pinnedAt: announcements.pinnedAt,
        status: announcements.status,
        publishAt: announcements.publishAt,
        expiresAt: announcements.expiresAt,
        archivedAt: announcements.archivedAt,
        createdBy: announcements.createdBy,
        createdAt: announcements.createdAt,
        updatedAt: announcements.updatedAt,
      })
      .from(announcements)
      .where(eq(announcements.id, announcementId))
      .limit(1)
  )[0];

  return row ?? null;
}

async function requireModerator(c: Context): Promise<SessionUser | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return buildError(c, "UNAUTHORIZED", "Authentication required");
  }
  if (!hasRoleAtLeast(resolved.user.role, "moderator")) {
    return buildError(c, "FORBIDDEN", "Moderator role required");
  }

  return resolved.user;
}

announcementsRoutes.get("/", async (c) => {
  const resolved = await resolveSession(c);
  const canReadAll = Boolean(resolved && hasRoleAtLeast(resolved.user.role, "moderator"));
  const query = c.req.query();
  const page = parsePage(query.page, 1);
  const limit = Math.min(100, parsePage(query.limit, 20));
  const offset = (page - 1) * limit;
  const statusFilter = query.status;
  const pinnedFilter = parseBoolean(query.pinned);
  const archivedFilter = parseBoolean(query.archived);
  const search = (query.search ?? "").trim();
  const archivedOnly = archivedFilter === true;

  const filters: SQL<unknown>[] = [];
  if (statusFilter) {
    if (!canReadAll && statusFilter !== "published" && statusFilter !== "archived") {
      return buildError(c, "FORBIDDEN", "Moderator role required to read non-public announcements");
    }
    filters.push(eq(announcements.status, statusFilter as typeof announcements.status.enumValues[number]));
  } else if (!canReadAll) {
    // Members/external: show published + archived, hide draft/scheduled
    if (archivedOnly) {
      filters.push(eq(announcements.status, "archived"));
    } else {
      filters.push(inArray(announcements.status, ["published", "archived"]));
    }
  }

  if (pinnedFilter !== undefined) {
    filters.push(eq(announcements.pinned, pinnedFilter));
  }

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    filters.push(or(like(announcements.title, pattern), like(announcements.bodyJson, pattern))!);
  }

  const whereClause = and(...filters);
  const db = getDb(c);

  const totalRow = (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(announcements)
      .where(whereClause)
  )[0];

  const total = Number(totalRow?.count ?? 0);
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      bodyJson: announcements.bodyJson,
      pinned: announcements.pinned,
      pinnedAt: announcements.pinnedAt,
      status: announcements.status,
      publishAt: announcements.publishAt,
      expiresAt: announcements.expiresAt,
      archivedAt: announcements.archivedAt,
      createdBy: announcements.createdBy,
      createdAt: announcements.createdAt,
      updatedAt: announcements.updatedAt,
    })
    .from(announcements)
    .where(whereClause)
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt), desc(announcements.id))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(toAnnouncementPayload),
    total,
    page,
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
});

announcementsRoutes.get("/:id", async (c) => {
  const resolved = await resolveSession(c);
  const canReadAll = Boolean(resolved && hasRoleAtLeast(resolved.user.role, "moderator"));
  const announcementId = c.req.param("id");
  const row = await getAnnouncementById(c, announcementId);
  if (!row) {
    return buildError(c, "NOT_FOUND", "Announcement not found");
  }
  if (!canReadAll && row.status !== "published" && row.status !== "archived") {
    return buildError(c, "NOT_FOUND", "Announcement not found");
  }
  return c.json(toAnnouncementPayload(row));
});

announcementsRoutes.post("/", async (c) => {
  const sessionUser = await requireModerator(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  }

  const nowIso = new Date().toISOString();
  const announcementId = nanoid();
  const db = getDb(c);

  await db.insert(announcements).values({
    id: announcementId,
    title: parsed.data.title,
    bodyJson: parsed.data.body_json,
    pinned: parsed.data.pinned,
    pinnedAt: parsed.data.pinned ? nowIso : null,
    status: parsed.data.status,
    publishAt: parsed.data.publish_at ?? null,
    expiresAt: parsed.data.expires_at ?? null,
    archivedAt: null,
    createdBy: sessionUser.id,
    updatedAt: nowIso,
  });

  if (parsed.data.status === "published") {
    await dispatchAnnouncementNotifications(c, {
      id: announcementId,
      title: parsed.data.title,
      bodyJson: parsed.data.body_json,
      publishAt: parsed.data.publish_at ?? nowIso,
      notifyDiscord: parsed.data.notify_discord,
      notifyWechat: parsed.data.notify_wechat,
    });
  }

  const created = await getAnnouncementById(c, announcementId);
  if (!created) {
    return buildError(c, "SERVER_ERROR", "Failed to create announcement");
  }

  await writeAuditLog(c, {
    entityType: "announcement",
    action: "create",
    actorId: sessionUser.id,
    entityId: announcementId,
    diffTitle: created.title,
  });
  await publishEntityChanged(c.env as Bindings, {
    entityType: "announcement",
    entityId: announcementId,
    hint: "announcement_created",
  });
  if (created.status === "published") {
    await publishAnnouncementPublished(c.env as Bindings, {
      announcementId: created.id,
      title: created.title,
      publishedAt: created.publishAt ?? created.updatedAt,
    });
  }

  return c.json(toAnnouncementPayload(created), 201);
});

announcementsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireModerator(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const announcementId = c.req.param("id");
  const existing = await getAnnouncementById(c, announcementId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Announcement not found");
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }

  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return buildError(c, "VALIDATION_ERROR", "Invalid announcement payload", parsed.error.flatten());
  }

  const patch: Partial<typeof announcements.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.body_json !== undefined) patch.bodyJson = parsed.data.body_json;
  if (parsed.data.pinned !== undefined) {
    patch.pinned = parsed.data.pinned;
    patch.pinnedAt = parsed.data.pinned ? patch.updatedAt : null;
  }
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.publish_at !== undefined) patch.publishAt = parsed.data.publish_at;
  if (parsed.data.expires_at !== undefined) patch.expiresAt = parsed.data.expires_at;
  if (parsed.data.archived_at !== undefined) patch.archivedAt = parsed.data.archived_at;

  const db = getDb(c);
  await db.update(announcements).set(patch).where(eq(announcements.id, announcementId));

  const updated = await getAnnouncementById(c, announcementId);
  if (!updated) {
    return buildError(c, "SERVER_ERROR", "Failed to load updated announcement");
  }

  const statusAfter = parsed.data.status ?? existing.status;
  if (statusAfter === "published" && (parsed.data.notify_discord || parsed.data.notify_wechat)) {
    await dispatchAnnouncementNotifications(c, {
      id: updated.id,
      title: updated.title,
      bodyJson: updated.bodyJson,
      publishAt: updated.publishAt ?? updated.updatedAt,
      notifyDiscord: parsed.data.notify_discord ?? false,
      notifyWechat: parsed.data.notify_wechat ?? false,
    });
  }

  await writeAuditLog(c, {
    entityType: "announcement",
    action: "update",
    actorId: sessionUser.id,
    entityId: announcementId,
    diffTitle: updated.title,
    detailText: JSON.stringify(parsed.data),
  });
  await publishEntityChanged(c.env as Bindings, {
    entityType: "announcement",
    entityId: announcementId,
    hint: "announcement_updated",
  });
  if (existing.status !== "published" && updated.status === "published") {
    await publishAnnouncementPublished(c.env as Bindings, {
      announcementId: updated.id,
      title: updated.title,
      publishedAt: updated.publishAt ?? updated.updatedAt,
    });
  }

  return c.json(toAnnouncementPayload(updated));
});

announcementsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireModerator(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const announcementId = c.req.param("id");
  const existing = await getAnnouncementById(c, announcementId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Announcement not found");
  }

  const nowIso = new Date().toISOString();
  const db = getDb(c);
  await db
    .update(announcements)
    .set({
      status: "archived",
      archivedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(announcements.id, announcementId));

  await writeAuditLog(c, {
    entityType: "announcement",
    action: "archive",
    actorId: sessionUser.id,
    entityId: announcementId,
    diffTitle: existing.title,
  });
  await publishEntityChanged(c.env as Bindings, {
    entityType: "announcement",
    entityId: announcementId,
    hint: "announcement_archived",
  });

  return c.json({ ok: true });
});

announcementsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireModerator(c);
  if (sessionUser instanceof Response) {
    return sessionUser;
  }

  const announcementId = c.req.param("id");
  const existing = await getAnnouncementById(c, announcementId);
  if (!existing) {
    return buildError(c, "NOT_FOUND", "Announcement not found");
  }

  const form = await c.req.formData();
  const files: File[] = [];
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

  const env = c.env as Bindings;
  const keys: string[] = [];
  for (const file of files) {
    const key = `announcement/${announcementId}/images/${Date.now()}_${nanoid()}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
    });
    keys.push(key);
  }

  await writeAuditLog(c, {
    entityType: "announcement",
    action: "upload_images",
    actorId: sessionUser.id,
    entityId: announcementId,
    detailText: JSON.stringify({ keys }),
  });

  return c.json({ keys });
});
