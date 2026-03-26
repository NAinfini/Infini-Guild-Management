import {
  ERROR_STATUS,
  createEventSchema,
  createTemplateSchema,
  updateEventSchema,
  updateTemplateSchema,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { runEventInstanceGenerationCron } from "../crons/event-instance-gen";
import { events } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import {
  EventService,
  EventServiceValidationError,
  toEventPayload,
  toParticipantPayload,
  toTemplatePayload,
} from "../services/EventService";
import { publishEntityChanged } from "../services/push";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const eventsRoutes = new Hono();

function getDb(c: Context) {
  return drizzle((c.env as Bindings).DB);
}

function getEventService(c: Context) {
  const env = c.env as Bindings;
  const db = getDb(c);
  const svc = new EventService(db as never, env.DB as never, env.MEDIA as never, {
    getEventById: (eventId) => svc.getEventById(eventId),
    materializeRecurringSeries: (templateId) => materializeRecurringSeries(c, templateId),
    writeAuditLog: (input) => writeAuditLog(c, input),
    publishEntityChanged: (payload) => publishEntityChanged(env, payload),
  });
  return svc;
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = { error_code: code, message, request_id: requestId, ...(details ? { details } : {}) };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

function parseBoolean(v: string | undefined): boolean | undefined {
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function parsePage(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function requireEventManager(c: Context) { return requirePermission(c, "events.manage"); }

async function requireSessionUser(c: Context) {
  const user = await getRequestUser(c);
  return user ?? buildError(c, "UNAUTHORIZED", "Authentication required");
}

async function parseJsonBody(c: Context): Promise<unknown | Response> {
  try { return await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
}

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

async function materializeRecurringSeries(c: Context, templateId: string): Promise<void> {
  const db = getDb(c);
  for (let pass = 0; pass < 64; pass += 1) {
    const before = (await db.select({ generationCount: events.generationCount, lastGeneratedDate: events.lastGeneratedDate }).from(events).where(eq(events.id, templateId)).limit(1))[0];
    await runEventInstanceGenerationCron(c.env as Bindings);
    const after = (await db.select({ generationCount: events.generationCount, lastGeneratedDate: events.lastGeneratedDate }).from(events).where(eq(events.id, templateId)).limit(1))[0];
    if (!before || !after || (before.generationCount === after.generationCount && before.lastGeneratedDate === after.lastGeneratedDate)) return;
  }
}

// --- Routes ---

eventsRoutes.get("/", async (c) => {
  const q = c.req.query();
  return c.json(await getEventService(c).listEvents({
    page: parsePage(q.page, 1), limit: Math.min(100, parsePage(q.limit, 20)),
    typeFilter: q.type, archivedFilter: parseBoolean(q.archived), startAfter: q.start_after, startBefore: q.start_before,
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
  return c.json({ data: await getEventService(c).batchDetails(ids) });
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
  const detail = await getEventService(c).getEventDetail(c.req.param("id"));
  return detail ? c.json(detail) : buildError(c, "NOT_FOUND", "Event not found");
});

eventsRoutes.post("/", async (c) => {
  const sessionUser = await requireEventManager(c);
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
  const sessionUser = await requireEventManager(c);
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
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.archiveEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/:id/destroy", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing) return buildError(c, "NOT_FOUND", "Event not found");
  await svc.destroyEvent(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/:id/images", async (c) => {
  const sessionUser = await requireEventManager(c);
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
  await getEventService(c).leaveEvent(sessionUser.id, c.req.param("id"));
  return c.json({ ok: true });
});

eventsRoutes.post("/:id/participants", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await parseJsonBody(c);
  if (body instanceof Response) return body;
  const payload = body as { user_id?: unknown };
  if (typeof payload.user_id !== "string" || payload.user_id.length === 0)
    return buildError(c, "VALIDATION_ERROR", "user_id is required");
  const result = await getEventService(c).addParticipant(sessionUser.id, c.req.param("id"), payload.user_id);
  return result.ok ? c.json(toParticipantPayload(result.participant), 201) : buildError(c, result.code, result.message);
});

eventsRoutes.delete("/:id/participants/:userId", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  await getEventService(c).removeParticipant(sessionUser.id, c.req.param("id"), c.req.param("userId"));
  return c.json({ ok: true });
});

// --- Templates ---

eventsRoutes.get("/templates/list", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  return c.json({ data: await getEventService(c).listTemplates() });
});

eventsRoutes.post("/templates", async (c) => {
  const sessionUser = await requireEventManager(c);
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
  const sessionUser = await requireEventManager(c);
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
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.pauseTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.post("/templates/:id/resume", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.resumeTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});

eventsRoutes.delete("/templates/:id", async (c) => {
  const sessionUser = await requireEventManager(c);
  if (sessionUser instanceof Response) return sessionUser;
  const svc = getEventService(c);
  const existing = await svc.getEventById(c.req.param("id"));
  if (!existing || !existing.isSeriesParent) return buildError(c, "NOT_FOUND", "Template not found");
  await svc.deleteTemplate(sessionUser.id, existing.id, existing);
  return c.json({ ok: true });
});
