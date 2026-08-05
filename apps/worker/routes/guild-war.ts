import {
  concludeWarPayloadSchema,
  createWarHistorySchema,
  moveGuildWarMemberSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateGuildWarRoleTagsSchema,
  updateWarHistorySchema,
} from "@guild/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Bindings } from "../index";
import { getRequestUser, requirePermission } from "../middleware/rbac";
import { GuildWarService } from "../services/GuildWarService";
import { buildError, getDb, handleResult, parsePage, parseJsonBody } from "./_shared";
import { withMedia } from "./service-factory";

export const guildWarRoutes = new Hono();

function getService(c: Context): GuildWarService {
  const env = c.env as Bindings;
  return new GuildWarService(getDb(c), {
    ...withMedia(c),
    rawDb: env.DB,
  });
}

async function requireGuildWarTeamsEdit(c: Context) { return requirePermission(c, "guildwar.teams.edit"); }
async function requireGuildWarHistoryEditor(c: Context) { return requirePermission(c, "guildwar.history.edit"); }

// --- Routes ---

guildWarRoutes.get("/active", async (c) => {
  // Guest-visible read route: browsing war boards/history is public; team
  // editing, concluding wars, exports, and stat mutations remain permission-gated.
  const viewer = await getRequestUser(c);
  const result = await getService(c).getActive(
    c.req.query("event_id"),
    viewer?.permissions.has("guildwar.teams.edit") ?? false,
  );
  return handleResult(c, result);
});

guildWarRoutes.get("/concluded-event-ids", async (c) => {
  const ids = await getService(c).getConcludedEventIds();
  return c.json({ data: ids });
});

guildWarRoutes.post("/save-teams", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  const body = await parseJsonBody(c);
  const parsed = saveTeamsPayloadSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid save teams payload", parsed.error.flatten());
  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag = etagFromHeader && etagFromHeader !== "*" ? etagFromHeader : undefined;
  const result = await getService(c).saveTeams(user.id, parsed.data, conditionalEtag);
  return handleResult(c, result);
});

guildWarRoutes.post("/move", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  const body = await parseJsonBody(c);
  const parsed = moveGuildWarMemberSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid move payload", parsed.error.flatten());
  const etagFromHeader = c.req.header("If-Match");
  const conditionalEtag = etagFromHeader && etagFromHeader !== "*" ? etagFromHeader : undefined;
  const result = await getService(c).moveMembers(user.id, parsed.data.event_id, parsed.data.moves, conditionalEtag);
  return handleResult(c, result);
});

guildWarRoutes.patch("/role-tag", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  const body = await parseJsonBody(c);
  const parsed = updateGuildWarRoleTagsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid role tag update payload", parsed.error.flatten());
  const result = await getService(c).setRoleTags(user.id, parsed.data.event_id, parsed.data.updates);
  return handleResult(c, result);
});

guildWarRoutes.post("/conclude", async (c) => {
  const user = await requireGuildWarTeamsEdit(c);
  const body = await parseJsonBody(c);
  const parsed = concludeWarPayloadSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid conclude payload", parsed.error.flatten());
  const result = await getService(c).concludeWar(user.id, parsed.data.event_id, parsed.data.war_info, parsed.data.member_stats);
  return handleResult(c, result);
});

guildWarRoutes.get("/export", async (c) => {
  await requireGuildWarHistoryEditor(c);
  const format = (c.req.query("format") ?? "csv").trim().toLowerCase();
  if (format !== "csv" && format !== "json") return buildError(c, "VALIDATION_ERROR", "format must be csv or json");
  const result = await getService(c).exportHistory(format, { dateFrom: c.req.query("date_from"), dateTo: c.req.query("date_to"), eventId: c.req.query("event_id") });
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  const { content, contentType, filename } = result.data;
  return new Response(content, { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${filename}"` } });
});

guildWarRoutes.get("/history", async (c) => {
  // Guest-visible read route; write/export routes below retain stricter guards.
  const page = parsePage(c.req.query("page"), 1);
  const limit = Math.min(100, parsePage(c.req.query("limit"), 20));
  const result = await getService(c).listHistory(page, limit, {
    dateFrom: c.req.query("date_from"),
    dateTo: c.req.query("date_to"),
    search: c.req.query("search"),
  });
  return handleResult(c, result);
});

guildWarRoutes.get("/history/batch", async (c) => {
  // Read-only batch detail lookup used by the public history UI; this is not a mutation.
  const ids = (c.req.queries("ids") ?? [])
    .flatMap((item) => item.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.json({ data: [] });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch request");
  const result = await getService(c).batchHistory(ids);
  return handleResult(c, result);
});

guildWarRoutes.get("/history/:id", async (c) => {
  // Guest-visible read route; edit/delete/member-stat routes stay protected.
  const result = await getService(c).getHistoryDetail(c.req.param("id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/history", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  const body = await parseJsonBody(c);
  const parsed = createWarHistorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  const result = await getService(c).createHistory(user.id, parsed.data);
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, 201);
});

guildWarRoutes.patch("/history/:id", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  const body = await parseJsonBody(c);
  const parsed = updateWarHistorySchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid war history payload", parsed.error.flatten());
  const result = await getService(c).updateHistory(user.id, c.req.param("id"), parsed.data);
  return handleResult(c, result);
});

guildWarRoutes.delete("/history/:id", async (c) => {
  const user = await requirePermission(c, "guildwar.history.edit");
  const result = await getService(c).deleteHistory(user.id, c.req.param("id"));
  return handleResult(c, result);
});

guildWarRoutes.post("/history/batch-delete", async (c) => {
  const user = await requirePermission(c, "guildwar.history.edit");
  const body = await parseJsonBody(c);
  if (!body || typeof body !== "object" || !Array.isArray((body as { ids?: unknown }).ids)) return buildError(c, "VALIDATION_ERROR", "Body must contain an ids array");
  const ids = ((body as { ids: string[] }).ids).filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return c.json({ ok: true, deleted: 0 });
  if (ids.length > 50) return buildError(c, "VALIDATION_ERROR", "Maximum 50 ids per batch delete");
  const result = await getService(c).batchDeleteHistory(user.id, ids);
  return handleResult(c, result);
});

guildWarRoutes.patch("/history/:id/member-stats/batch", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  const body = await parseJsonBody(c);
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

guildWarRoutes.patch("/history/:id/member-stats/:userId", async (c) => {
  const user = await requireGuildWarHistoryEditor(c);
  const body = await parseJsonBody(c);
  const parsed = updateMemberStatsSchema.safeParse(body);
  if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid member stats payload", parsed.error.flatten());
  const result = await getService(c).updateMemberStats(user.id, c.req.param("id"), c.req.param("userId"), parsed.data);
  return handleResult(c, result);
});

guildWarRoutes.get("/analytics", async (c) => {
  // Guest-visible aggregate analytics; no user/mod/admin capability is granted here.
  const warIdsRaw = c.req.queries("war_ids") ?? [];
  const userIdsRaw = c.req.queries("user_ids") ?? [];
  const warIds = warIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  const userIds = userIdsRaw.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  if (warIds.length > 20) return buildError(c, "VALIDATION_ERROR", "Maximum 20 war_ids");
  if (userIds.length > 100) return buildError(c, "VALIDATION_ERROR", "Maximum 100 user_ids");
  const result = await getService(c).getAnalytics(warIds, userIds);
  return handleResult(c, result);
});
