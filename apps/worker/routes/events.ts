import {
  createEventSchema,
  createTemplateSchema,
  eventParticipantsBatchSchema,
  pollVoteSchema,
  updateEventSchema,
  updateTemplateSchema,
} from "@guild/shared";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { runEventInstanceGenerationCron } from "../crons/event-instance-gen";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { users } from "../db/schema";
import {
  EventService,
  toEventPayload,
  toParticipantPayload,
  toRaffleWinnerPayload,
  toTemplatePayload,
} from "../services/EventService";
import { parseMediaKey } from "../services/media-keys";
import { buildError, collectFiles, getDb, parseBoolean, parseJsonBody, parsePage, requireSessionUser, serveR2Object } from "./_shared";
import { commonDeps, getMediaPolicy } from "./service-factory";
import { getSystemTestRunId } from "../services/SystemTestService";
import { protectContentMediaBucket } from "../services/media";

export const eventsRoutes = new Hono();

function getEventService(c: Context) {
  const db = getDb(c);
  const deps = {
    getEventById: (eventId: string) => svc.getEventById(eventId),
    getUsername: async (userId: string) => {
      const row = (await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1))[0];
      return row?.username ?? null;
    },
    getMediaPolicy: () => getMediaPolicy(c),
    ...commonDeps(c),
  };
  const templateDeps = {
    getTemplateById: (templateId: string) => svc.getTemplateById(templateId),
    materializeRecurringSeries: (templateId: string) => materializeRecurringSeries(c, templateId),
    writeAuditLog: deps.writeAuditLog,
    getGameRules: deps.getGameRules,
    systemTestRunId: getSystemTestRunId(c),
  };
  const svc: EventService = new EventService(
    db as never,
    (c.env as Bindings).DB as never,
    protectContentMediaBucket((c.env as Bindings).MEDIA) as never,
    deps,
    templateDeps,
  );
  return svc;
}

async function requireEventCreate(c: Context) { return requirePermission(c, "events.create"); }
async function requireEventEdit(c: Context) { return requirePermission(c, "events.edit"); }
async function requireEventArchive(c: Context) { return requirePermission(c, "events.archive"); }
async function requireEventDelete(c: Context) { return requirePermission(c, "events.delete"); }
async function requireEventTemplates(c: Context) { return requirePermission(c, "events.templates"); }

async function parseCreateEventRequest(c: Context): Promise<{ body: unknown; files: File[] } | Response> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const raw = form.get("data");
    if (typeof raw !== "string" || !raw.trim()) return buildError(c, "VALIDATION_ERROR", "Missing data payload");
    try { return { body: JSON.parse(raw), files: collectFiles(form) }; } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  }
  try { return { body: await c.req.json(), files: [] }; } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
}

async function materializeRecurringSeries(c: Context, templateId: string): Promise<void> {
  await runEventInstanceGenerationCron(c.env as Bindings, {
    templateId,
    systemTestRunId: getSystemTestRunId(c) ?? undefined,
  });
}

// --- Routes ---

eventsRoutes.get("/", async (c) => {
  const q = c.req.query();
  const viewer = await getRequestUser(c);
  return c.json(await getEventService(c).listEvents({
    page: parsePage(q.page, 1), limit: Math.min(100, parsePage(q.limit, 20)),
    typeFilter: q.type,
    archivedFilter: parseBoolean(q.archived),
    pinnedFilter: parseBoolean(q.pinned),
    lockedFilter: parseBoolean(q.locked),
    search: (q.search ?? "").trim() || undefined,
    startAfter: q.start_after,
    startBefore: q.start_before,
    viewerId: viewer?.id ?? null,
    canManage: viewer?.permissions.has("events.edit") ?? false,
  }));
});

eventsRoutes.post("/batch-details", async (c) => {
  const body = await parseJsonBody(c);
  if (!body || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids))
    return buildError(c, "VALIDATION_ERROR", "Body must contain an ids array");
  const ids = ((body as { ids: string[] }).ids).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return c.json({ data: [] });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch request");
  const viewer = await getRequestUser(c);
  return c.json({ data: await getEventService(c).batchDetails(ids, viewer?.id ?? null, viewer?.permissions.has("events.edit") ?? false) });
});

eventsRoutes.get("/image", async (c) => {
  const key = c.req.query("key");
  if (!key) return buildError(c, "VALIDATION_ERROR", "key query parameter required");
  const parsedKey = parseMediaKey(key);
  if (parsedKey?.kind !== "event_image" || !parsedKey.entityId || !parsedKey.contentType) {
    return buildError(c, "FORBIDDEN", "Invalid event image key");
  }
  const viewer = await getRequestUser(c);
  const canManage = viewer?.permissions.has("events.edit") === true;
  const referenced = await (c.env as Bindings).DB.prepare(`
    SELECT 1 AS present
    FROM media_references ref
    INNER JOIN event_attachments attachment
      ON attachment.media_key = ref.media_key
     AND attachment.event_id = ref.entity_id
    INNER JOIN events event ON event.id = attachment.event_id
    WHERE ref.media_key = ?1
      AND ref.entity_type = 'event'
      AND (
        ?2 = 1
        OR event.visible_at IS NULL
        OR (julianday(event.visible_at) IS NOT NULL AND julianday(event.visible_at) <= julianday(?3))
      )
    LIMIT 1
  `).bind(key, canManage ? 1 : 0, new Date().toISOString()).first<{ present: number }>();
  if (!referenced) return buildError(c, "NOT_FOUND", "Event image not found");
  return serveR2Object(c, key, "Event image not found");
});

eventsRoutes.get("/:id", async (c) => {
  const viewer = await getRequestUser(c);
  const detail = await getEventService(c).getEventDetail(c.req.param("id"), viewer?.id ?? null, viewer?.permissions.has("events.edit") ?? false);
  return detail ? c.json(detail) : buildError(c, "NOT_FOUND", "Event not found");
});

eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireEventCreate(c);
  const parsed_req = await parseCreateEventRequest(c);
  if (parsed_req instanceof Response) return parsed_req;
  const { body, files } = parsed_req;
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid create event payload", parsed.error.flatten());
  const result = await getEventService(c).createEvent(sessionUser.id, parsed.data, files);
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json(toEventPayload(result.data), 201);
});

eventsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireEventEdit(c);
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  const body = await parseJsonBody(c);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid update event payload", parsed.error.flatten());
  const result = await svc.updateEvent(sessionUser.id, existing.id, existing, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json(toEventPayload(result.data));
});

eventsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireEventArchive(c);
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.archiveEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/:id/destroy", async (c) => {
  const sessionUser = await requireEventDelete(c);
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.destroyEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireEventEdit(c);
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  const result = await svc.uploadEventImages(sessionUser.id, existing.id, existing, collectFiles(await c.req.formData()));
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json(result.data);
});

eventsRoutes.post("/:id/join", async (c) => {
  const sessionUser = await requireSessionUser(c);
  const result = await getEventService(c).joinEvent(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json(toParticipantPayload(result.participant), 201) : buildError(c, result.code, result.message);
});

eventsRoutes.delete("/:id/leave", async (c) => {
  const sessionUser = await requireSessionUser(c);
  const result = await getEventService(c).leaveEvent(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message);
});

eventsRoutes.post("/:id/poll/vote", async (c) => {
  const sessionUser = await requireSessionUser(c);
  const body = await parseJsonBody(c);
  const parsed = pollVoteSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid poll vote payload", parsed.error.flatten());
  const result = await getEventService(c).votePoll(sessionUser.id, c.req.param("id"), parsed.data.option_ids);
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message);
});

eventsRoutes.post("/:id/raffle/draw", async (c) => {
  const sessionUser = await requireEventEdit(c);
  const result = await getEventService(c).drawRaffleWinners(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ data: result.winners.map(toRaffleWinnerPayload) }) : buildError(c, result.code, result.message);
});

eventsRoutes.post("/:id/participants", async (c) => {
  const sessionUser = await requireEventEdit(c);
  const body = await parseJsonBody(c);
  const parsed = eventParticipantsBatchSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid participant payload", parsed.error.flatten());
  const result = await getEventService(c).addParticipants(sessionUser.id, c.req.param("id"), parsed.data.user_ids);
  return result.ok ? c.json({ data: result.participants.map(toParticipantPayload) }, 201) : buildError(c, result.code, result.message);
});

eventsRoutes.delete("/:id/participants", async (c) => {
  const sessionUser = await requireEventEdit(c);
  const body = await parseJsonBody(c);
  const parsed = eventParticipantsBatchSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid participant payload", parsed.error.flatten());
  const result = await getEventService(c).removeParticipants(sessionUser.id, c.req.param("id"), parsed.data.user_ids);
  return result.ok ? c.json(result) : buildError(c, result.code, result.message);
});

// --- Templates ---

eventsRoutes.get("/templates/list", async (c) => {
  await requireEventTemplates(c);
  return c.json({ data: await getEventService(c).listTemplates() });
});

eventsRoutes.post("/templates", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  const body = await parseJsonBody(c);
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid template payload", parsed.error.flatten());
  const result = await getEventService(c).createTemplate(sessionUser.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json(toTemplatePayload(result.data), 201);
});

eventsRoutes.patch("/templates/:id", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  const svc = getEventService(c);
  const existing = await svc.getTemplateById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Template not found");
  const body = await parseJsonBody(c);
  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid template update payload", parsed.error.flatten());
  const result = await svc.updateTemplate(sessionUser.id, existing.id, existing, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message);
  return c.json(toTemplatePayload(result.data));
});

eventsRoutes.post("/templates/:id/pause", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  const svc = getEventService(c);
  const existing = await svc.getTemplateById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.pauseTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/templates/:id/resume", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  const svc = getEventService(c);
  const existing = await svc.getTemplateById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.resumeTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/templates/:id", async (c) => {
  const sessionUser = await requirePermission(c, "events.templates");
  const svc = getEventService(c);
  const existing = await svc.getTemplateById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.deleteTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});
