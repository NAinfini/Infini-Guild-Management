import {
  ERROR_STATUS,
  applyWarTemplateSchema,
  createWarHistorySchema,
  createWarTemplateSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  type ErrorCode,
  type StandardErrorResponse,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { createBotTask } from "../services/bot-dispatch";
import { GuildWarService, toWarHistoryPayload } from "../services/GuildWarService";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const guildWarRoutes = new Hono();

function getDb(c: Context) {
  const env = c.env as Bindings;
  return drizzle(env.DB);
}

function getService(c: Context): GuildWarService {
  const env = c.env as Bindings;
  return new GuildWarService(getDb(c), {
    media: env.MEDIA,
    writeAuditLog: (input) => writeAuditLog(c, input),
    createBotTask: (input) => createBotTask(env, input),
    botRuntimeUrl: env.BOT_RUNTIME_URL ?? "",
    botSharedSecret: env.BOT_SHARED_SECRET ?? "",
    publishEntityChanged: (payload) => publishEntityChanged(env, payload),
  });
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = { error_code: code, message, request_id: requestId, ...(details ? { details } : {}) };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

async function requireGuildWarManager(c: Context) { return requirePermission(c, "guildwar.manage"); }
async function requireGuildWarHistoryEditor(c: Context) { return requirePermission(c, "guildwar.history.edit"); }

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function handleResult(c: Context, result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown }, status?: number): Response {
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, status as never);
}

// --- Routes ---

guildWarRoutes.get("/active", async (c) => {
  const result = await getService(c).getActive(c.req.query("event_id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/save-teams", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = saveTeamsPayloadSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid save teams payload", parsed.error.flatten());
  const result = await getService(c).saveTeams(user.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(toWarHistoryPayload(result.data));
});

guildWarRoutes.post("/move", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const payload = body as { event_id?: unknown; user_id?: unknown; to?: unknown; etag?: unknown };
  if (typeof payload.event_id !== "string" || typeof payload.user_id !== "string" || typeof payload.to !== "string") return buildError(c, "VALIDATION_ERROR", "event_id, user_id and to are required");
  if (payload.etag !== undefined && typeof payload.etag !== "string") return buildError(c, "VALIDATION_ERROR", "etag must be a string when provided");
  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag = etagFromHeader && etagFromHeader !== "*" ? etagFromHeader : typeof payload.etag === "string" ? payload.etag : undefined;
  const result = await getService(c).moveMember(user.id, payload.event_id, payload.user_id, payload.to, conditionalEtag);
  return handleResult(c, result);
});

guildWarRoutes.patch("/role-tag", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const payload = body as { event_id?: unknown; user_id?: unknown; role_tag?: unknown };
  if (typeof payload.event_id !== "string" || typeof payload.user_id !== "string") return buildError(c, "VALIDATION_ERROR", "event_id and user_id are required");
  if (payload.role_tag !== undefined && payload.role_tag !== null && typeof payload.role_tag !== "string") return buildError(c, "VALIDATION_ERROR", "role_tag must be string or null");
  const roleTag = typeof payload.role_tag === "string" ? payload.role_tag : null;
  const result = await getService(c).setRoleTag(user.id, payload.event_id, payload.user_id, roleTag);
  return handleResult(c, result);
});

guildWarRoutes.post("/post-teams", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const payload = body as { event_id?: unknown; platform?: unknown };
  if (typeof payload.event_id !== "string") return buildError(c, "VALIDATION_ERROR", "event_id is required");
  if (payload.platform !== "discord" && payload.platform !== "wechat") return buildError(c, "VALIDATION_ERROR", "platform must be discord or wechat");
  const result = await getService(c).postTeams(user.id, payload.event_id, payload.platform);
  return handleResult(c, result);
});

guildWarRoutes.post("/post-results", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const payload = body as { war_history_id?: unknown; platform?: unknown };
  if (typeof payload.war_history_id !== "string") return buildError(c, "VALIDATION_ERROR", "war_history_id is required");
  if (payload.platform !== "discord" && payload.platform !== "wechat") return buildError(c, "VALIDATION_ERROR", "platform must be discord or wechat");
  const result = await getService(c).postResults(user.id, payload.war_history_id, payload.platform);
  return handleResult(c, result);
});

guildWarRoutes.get("/export", async (c) => {
  const format = (c.req.query("format") ?? "csv").trim().toLowerCase();
  if (format !== "csv" && format !== "json") return buildError(c, "VALIDATION_ERROR", "format must be csv or json");
  const result = await getService(c).exportHistory(format, { dateFrom: c.req.query("date_from"), dateTo: c.req.query("date_to"), eventId: c.req.query("event_id") });
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  const { content, contentType, filename } = result.data;
  return new Response(content, { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${filename}"` } });
});

guildWarRoutes.get("/templates", async (c) => {
  const result = await getService(c).listTemplates(c.req.query("event_id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/templates", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = createWarTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war template payload", parsed.error.flatten());
  const data = parsed.data;
  const result = data.template_type === "structure"
    ? await getService(c).createStructureTemplate(user.id, data.template_name, data.description ?? null, data.event_id)
    : await getService(c).createMemberTemplate(user.id, data.template_name, data.description ?? null, data.user_ids);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

guildWarRoutes.post("/templates/apply", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = applyWarTemplateSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war template apply payload", parsed.error.flatten());
  const svc = getService(c);
  const template = await svc.getWarTemplateById(parsed.data.template_id);
  if (!template) return buildError(c, "NOT_FOUND", "War template not found");
  if (template.templateType === "structure") {
    const result = await svc.applyStructureTemplate(user.id, parsed.data.template_id, parsed.data.event_id);
    return handleResult(c, result);
  }
  if (!parsed.data.team_id) return buildError(c, "VALIDATION_ERROR", "team_id is required for member templates");
  const result = await svc.applyMemberTemplate(user.id, parsed.data.template_id, parsed.data.event_id, parsed.data.team_id, parsed.data.force_signup_user_ids);
  return handleResult(c, result);
});

guildWarRoutes.delete("/templates/:id", async (c) => {
  const user = await requireGuildWarManager(c);
  if (user instanceof Response) return user;
  const result = await getService(c).deleteTemplate(user.id, c.req.param("id"));
  return handleResult(c, result);
});

guildWarRoutes.get("/history", async (c) => {
  const page = parsePage(c.req.query("page"), 1);
  const limit = Math.min(100, parsePage(c.req.query("limit"), 20));
  const result = await getService(c).listHistory(page, limit, { dateFrom: c.req.query("date_from"), dateTo: c.req.query("date_to") });
  return handleResult(c, result);
});

guildWarRoutes.post("/history/batch", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  if (!body || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids)) return buildError(c, "VALIDATION_ERROR", "Body must contain an ids array");
  const ids = ((body as { ids: string[] }).ids).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return c.json({ data: [] });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch request");
  const result = await getService(c).batchHistory(ids);
  return handleResult(c, result);
});

guildWarRoutes.get("/history/:id", async (c) => {
  const result = await getService(c).getHistoryDetail(c.req.param("id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/history", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = createWarHistorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  const result = await getService(c).createHistory(user.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

guildWarRoutes.patch("/history/:id", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateWarHistorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  const result = await getService(c).updateHistory(user.id, c.req.param("id"), parsed.data);
  return handleResult(c, result);
});

guildWarRoutes.delete("/history/:id", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  const result = await getService(c).deleteHistory(user.id, c.req.param("id"));
  return handleResult(c, result);
});

guildWarRoutes.patch("/history/:id/member-stats/:userId", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateMemberStatsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid member stats payload", parsed.error.flatten());
  const result = await getService(c).updateMemberStats(user.id, c.req.param("id"), c.req.param("userId"), parsed.data);
  return handleResult(c, result);
});

guildWarRoutes.patch("/history/:id/member-stats/batch", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  if (!body || typeof body !== "object" || !Array.isArray((body as { updates?: unknown }).updates)) return buildError(c, "VALIDATION_ERROR", "Body must contain an updates array");
  const updates = (body as { updates: Array<{ user_id: string; stats: unknown }> }).updates;
  if (updates.length === 0) return c.json({ data: [] });
  if (updates.length > 100) return buildError(c, "VALIDATION_ERROR", "Maximum 100 updates per batch request");
  const result = await getService(c).batchUpdateMemberStats(user.id, c.req.param("id"), updates);
  return handleResult(c, result);
});

guildWarRoutes.get("/analytics", async (c) => {
  const warIdsRaw = c.req.queries("war_ids") ?? [];
  const userIdsRaw = c.req.queries("user_ids") ?? [];
  const warIds = warIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const userIds = userIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const result = await getService(c).getAnalytics(warIds, userIds);
  return handleResult(c, result);
});
