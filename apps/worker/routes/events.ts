import {
  createEventSchema,
  createTemplateSchema,
  eventParticipantsBatchSchema,
  pollVoteSchema,
  updateEventSchema,
  updateTemplateSchema,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { runEventInstanceGenerationCron } from "../crons/event-instance-gen";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { users } from "../db/schema";
import {
  EventService,
  EventServiceValidationError,
  toEventPayload,
  toParticipantPayload,
  toTemplatePayload,
} from "../services/EventService";
import { publishEntityChanged } from "../services/push";
import { buildError, parseBoolean, parseJsonBody, parsePage, requireSessionUser } from "./_shared";

export const eventsRoutes = new Hono();

function getDb(c: Context) {
  return drizzle((c.env as Bindings).DB);
}

function getEventService(c: Context) {
  const env = c.env as Bindings;
  const db = getDb(c);
  const svc: EventService = new EventService(db as never, env.DB as never, env.MEDIA as never, {
    getEventById: (eventId) => svc.getEventById(eventId),
    getUsername: async (userId) => {
      const row = (await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1))[0];
      return row?.username ?? null;
    },
    materializeRecurringSeries: (templateId) => materializeRecurringSeries(c, templateId),
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
  });
  return svc;
}

async function requireEventCreate(c: Context) { return requirePermission(c, "events.create"); }
async function requireEventEdit(c: Context) { return requirePermission(c, "events.edit"); }
async function requireEventArchive(c: Context) { return requirePermission(c, "events.archive"); }
async function requireEventDelete(c: Context) { return requirePermission(c, "events.delete"); }
async function requireEventTemplates(c: Context) { return requirePermission(c, "events.templates"); }

function collectFiles(form: FormData): File[] {
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  for (const item of form.getAll("files")) { if (item instanceof File) files.push(item); }
  return files;
}

async function parseCreateEventRequest(c: Context): Promise<{ body: unknown; files: File[] }> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const raw = form.get("data");
    if (typeof raw !== "string" || !raw.trim()) throw new EventServiceValidationError("Missing data payload");
    try { return { body: JSON.parse(raw), files: collectFiles(form) }; } catch { throw new EventServiceValidationError("Invalid JSON body"); }
  }
  try { return { body: await c.req.json(), files: [] }; } catch { throw new EventServiceValidationError("Invalid JSON body"); }
}

async function materializeRecurringSeries(c: Context, _templateId: string): Promise<void> {
  await runEventInstanceGenerationCron(c.env as Bindings);
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
  if (body instanceof Response) return body;
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
  if (!key.startsWith("events/")) return buildError(c, "FORBIDDEN", "Invalid event image key");

  const object = await (c.env as Bindings).MEDIA.get(key);
  if (!object?.body) return buildError(c, "NOT_FOUND", "Event image not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
});

eventsRoutes.get("/:id", async (c) => {
  const viewer = await getRequestUser(c);
  const detail = await getEventService(c).getEventDetail(c.req.param("id"), viewer?.id ?? null, viewer?.permissions.has("events.edit") ?? false);
  return detail ? c.json(detail) : buildError(c, "NOT_FOUND", "Event not found");
});

eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireEventCreate(c);
  if (sessionUser instanceof Response) return sessionUser;
  try {
    const { body, files } = await parseCreateEventRequest(c);
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid create event payload", parsed.error.flatten());
    return c.json(toEventPayload(await getEventService(c).createEvent(sessionUser.id, parsed.data, files)), 201);
  } catch (e) {
    if (e instanceof EventServiceValidationError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

eventsRoutes.patch("/:id", async (c) => {
  const sessionUser = await requireEventEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid update event payload", parsed.error.flatten());
  try {
    return c.json(toEventPayload(await svc.updateEvent(sessionUser.id, existing.id, existing, parsed.data)));
  } catch (e) {
    if (e instanceof EventServiceValidationError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

eventsRoutes.delete("/:id", async (c) => {
  const sessionUser = await requireEventArchive(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.archiveEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/:id/destroy", async (c) => {
  const sessionUser = await requireEventDelete(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.destroyEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireEventEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  try {
    const { keys, attachments } = await svc.uploadEventImages(sessionUser.id, existing.id, existing, collectFiles(await c.req.formData()));
    return c.json({ keys, attachments });
  } catch (e) {
    if (e instanceof EventServiceValidationError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

eventsRoutes.post("/:id/join", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getEventService(c).joinEvent(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json(toParticipantPayload(result.participant), 201) : buildError(c, result.code, result.message);
});

eventsRoutes.delete("/:id/leave", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const result = await getEventService(c).leaveEvent(sessionUser.id, c.req.param("id"));
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message);
});

eventsRoutes.post("/:id/poll/vote", async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = pollVoteSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid poll vote payload", parsed.error.flatten());
  const result = await getEventService(c).votePoll(sessionUser.id, c.req.param("id"), parsed.data.option_ids);
  return result.ok ? c.json({ ok: true }) : buildError(c, result.code, result.message);
});

eventsRoutes.post("/:id/participants", async (c) => {
  const sessionUser = await requireEventEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = eventParticipantsBatchSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid participant payload", parsed.error.flatten());
  const result = await getEventService(c).addParticipants(sessionUser.id, c.req.param("id"), parsed.data.user_ids);
  return result.ok ? c.json({ data: result.participants.map(toParticipantPayload) }, 201) : buildError(c, result.code, result.message);
});

eventsRoutes.delete("/:id/participants", async (c) => {
  const sessionUser = await requireEventEdit(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = eventParticipantsBatchSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid participant payload", parsed.error.flatten());
  return c.json(await getEventService(c).removeParticipants(sessionUser.id, c.req.param("id"), parsed.data.user_ids));
});

// --- Templates ---

eventsRoutes.get("/templates/list", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  return c.json({ data: await getEventService(c).listTemplates() });
});

eventsRoutes.post("/templates", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid template payload", parsed.error.flatten());
  try {
    return c.json(toTemplatePayload(await getEventService(c).createTemplate(sessionUser.id, parsed.data)), 201);
  } catch (e) {
    if (e instanceof EventServiceValidationError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

eventsRoutes.patch("/templates/:id", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid template update payload", parsed.error.flatten());
  try {
    return c.json(toTemplatePayload(await svc.updateTemplate(sessionUser.id, existing.id, existing, parsed.data)));
  } catch (e) {
    if (e instanceof EventServiceValidationError) return buildError(c, "VALIDATION_ERROR", e.message);
    throw e;
  }
});

eventsRoutes.post("/templates/:id/pause", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.pauseTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/templates/:id/resume", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.resumeTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/templates/:id", async (c) => {
  const sessionUser = await requireEventTemplates(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.deleteTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});
