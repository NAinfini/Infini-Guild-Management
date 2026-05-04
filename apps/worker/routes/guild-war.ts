import {
  createWarHistorySchema,
  moveGuildWarMemberSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateGuildWarRoleTagsSchema,
  updateWarHistorySchema,
} from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { requirePermission } from "../middleware/rbac";
import { writeAuditLog } from "../services/audit";
import { publishEntityChanged } from "../services/push";
import { GuildWarService, toWarHistoryPayload } from "../services/GuildWarService";
import { buildError, handleResult, parsePage } from "./_shared";

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
    publishEntityChanged: (payload) => publishEntityChanged(c, payload),
    rawDb: env.DB,
  });
}

async function requireGuildWarTeamsEdit(c: Context) { return requirePermission(c, "guildwar.teams.edit"); }
async function requireGuildWarHistoryEditor(c: Context) { return requirePermission(c, "guildwar.history.edit"); }

// --- Routes ---

guildWarRoutes.get("/active", async (c) => {
  const result = await getService(c).getActive(c.req.query("event_id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/save-teams", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = saveTeamsPayloadSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid save teams payload", parsed.error.flatten());
  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag = etagFromHeader && etagFromHeader !== "*" ? etagFromHeader : undefined;
  const result = await getService(c).saveTeams(user.id, parsed.data, conditionalEtag);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(toWarHistoryPayload(result.data));
});

guildWarRoutes.post("/move", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = moveGuildWarMemberSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid move payload", parsed.error.flatten());
  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag = etagFromHeader && etagFromHeader !== "*" ? etagFromHeader : undefined;
  const result = await getService(c).moveMembers(user.id, parsed.data.event_id, parsed.data.moves, conditionalEtag);
  return handleResult(c, result);
});

guildWarRoutes.patch("/role-tag", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  const parsed = updateGuildWarRoleTagsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role tag update payload", parsed.error.flatten());
  const result = await getService(c).setRoleTags(user.id, parsed.data.event_id, parsed.data.updates);
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

guildWarRoutes.post("/history/batch-delete", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  if (user instanceof Response) return user;
  let body: unknown;
  try { body = await c.req.json(); } catch { return buildError(c, "VALIDATION_ERROR", "Invalid JSON body"); }
  if (!body || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids)) return buildError(c, "VALIDATION_ERROR", "Body must contain an ids array");
  const ids = ((body as { ids: string[] }).ids).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return c.json({ ok: true, deleted: 0 });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch delete");
  const result = await getService(c).batchDeleteHistory(user.id, ids);
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
  for (const entry of updates) {
    if (typeof entry.user_id !== "string" || !entry.user_id) return buildError(c, "VALIDATION_ERROR", "Each update must have a non-empty user_id string");
    const statsParsed = updateMemberStatsSchema.safeParse(entry.stats);
    if (!statsParsed.success) return buildError(c, "VALIDATION_ERROR", `Invalid stats for user ${entry.user_id}`, statsParsed.error.flatten());
  }
  const result = await getService(c).batchUpdateMemberStats(user.id, c.req.param("id"), updates);
  return handleResult(c, result);
});

guildWarRoutes.get("/analytics", async (c) => {
  const warIdsRaw = c.req.queries("war_ids") ?? [];
  const userIdsRaw = c.req.queries("user_ids") ?? [];
  const warIds = warIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const userIds = userIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  if (warIds.length > 20) return buildError(c, "VALIDATION_ERROR", "Maximum 20 war_ids");
  if (userIds.length > 100) return buildError(c, "VALIDATION_ERROR", "Maximum 100 user_ids");
  const result = await getService(c).getAnalytics(warIds, userIds);
  return handleResult(c, result);
});
