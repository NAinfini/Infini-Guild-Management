import { AppError, type RequestContext } from "@guild/kernel";
import type { GuildWarService } from "@guild/server/modules/guild-war";
import {
  concludeWarPayloadSchema,
  createWarHistorySchema,
  guildWarHistoryDeleteBatchSchema,
  guildWarHistoryQuerySchema,
  guildWarMemberStatsBatchSchema,
  moveGuildWarMemberSchema,
  saveTeamsPayloadSchema,
  updateGuildWarRoleTagsSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
} from "@guild/shared";
import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody, parseQuery } from "../../core/parsing.js";
import {
  presentAnalytics,
  presentConcludeResult,
  presentConcludedEventIds,
  presentGuildWarActive,
  presentGuildWarOk,
  presentHistory,
  presentHistoryBatch,
  presentHistoryDeleteBatch,
  presentHistoryDetail,
  presentHistoryList,
  presentMember,
  presentMemberStats,
  presentRoleTagsResult,
} from "../../presenters/guild-war/guild-war-presenter.js";

type GuildWarHttpEnv = {
  Variables: { requestContext: RequestContext };
};

export type GuildWarRouteDependencies = Readonly<{ service: GuildWarService }>;

export function createGuildWarRoutes(dependencies: GuildWarRouteDependencies): Hono<GuildWarHttpEnv> {
  const routes = new Hono<GuildWarHttpEnv>();
  const requestContext = (context: { get(key: "requestContext"): RequestContext }) => context.get("requestContext");

  routes.get("/active", async (context) => {
    const request = requestContext(context);
    const view = await dependencies.service.active(request, context.req.query("event_id"));
    if (view.etag) context.header("ETag", view.etag);
    return context.json(presentGuildWarActive(view));
  });

  routes.get("/concluded-event-ids", async (context) => context.json(presentConcludedEventIds(
    await dependencies.service.concludedEventIds(),
  )));

  routes.post("/save-teams", async (context) => {
    const request = requestContext(context);
    const parsed = saveTeamsPayloadSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid save teams payload", parsed.error.flatten());
    await dependencies.service.saveTeams(
      request,
      parsed.data,
      conditionalEtag(context.req.header("If-Match")),
    );
    return context.json(presentGuildWarOk());
  });

  routes.post("/move", async (context) => {
    const request = requestContext(context);
    const parsed = moveGuildWarMemberSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid move payload", parsed.error.flatten());
    await dependencies.service.moveMembers(
      request,
      parsed.data.event_id,
      parsed.data.moves,
      conditionalEtag(context.req.header("If-Match")),
    );
    return context.json(presentGuildWarOk());
  });

  routes.patch("/role-tag", async (context) => {
    const request = requestContext(context);
    const parsed = updateGuildWarRoleTagsSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid role tag update payload", parsed.error.flatten());
    const result = await dependencies.service.setRoleTags(request, parsed.data.event_id, parsed.data.updates);
    return context.json(presentRoleTagsResult(result.updated));
  });

  routes.post("/conclude", async (context) => {
    const request = requestContext(context);
    const parsed = concludeWarPayloadSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid conclude payload", parsed.error.flatten());
    const result = await dependencies.service.conclude(
      request,
      parsed.data.event_id,
      parsed.data.war_info,
      parsed.data.member_stats,
    );
    return context.json(presentConcludeResult(result.war_history_id));
  });

  routes.get("/export", async (context) => {
    const request = requestContext(context);
    const format = (context.req.query("format") ?? "csv").trim().toLowerCase();
    if (format !== "csv" && format !== "json") throw invalidPayload("format must be csv or json");
    const result = await dependencies.service.export(request, format, {
      ...(context.req.query("event_id") ? { eventId: context.req.query("event_id")! } : {}),
      ...(context.req.query("date_from") ? { dateFrom: context.req.query("date_from")! } : {}),
      ...(context.req.query("date_to") ? { dateTo: context.req.query("date_to")! } : {}),
    });
    return new Response(result.content, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  });

  routes.get("/history", async (context) => {
    const query = parseQuery(context.req.raw, guildWarHistoryQuerySchema, "Invalid history query");
    const result = await dependencies.service.listHistory(requestContext(context), {
      page: query.page,
      limit: query.limit,
      ...(query.date_from ? { dateFrom: query.date_from } : {}),
      ...(query.date_to ? { dateTo: query.date_to } : {}),
      ...(query.search ? { search: query.search } : {}),
    });
    return context.json(presentHistoryList(result));
  });

  routes.get("/history/batch", async (context) => {
    const ids = queryIds(context.req.queries("ids"));
    if (ids.length === 0) return context.json(presentHistoryBatch([]));
    return context.json(presentHistoryBatch(
      await dependencies.service.historyBatch(requestContext(context), ids),
    ));
  });

  routes.post("/history/batch-delete", async (context) => {
    const request = requestContext(context);
    const parsed = guildWarHistoryDeleteBatchSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid history delete payload", parsed.error.flatten());
    const result = await dependencies.service.deleteHistoryBatch(request, parsed.data.ids);
    return context.json(presentHistoryDeleteBatch(result.deleted));
  });

  routes.get("/history/:id", async (context) => context.json(presentHistoryDetail(
    await dependencies.service.historyDetail(requestContext(context), context.req.param("id")),
  )));

  routes.post("/history", async (context) => {
    const request = requestContext(context);
    const parsed = createWarHistorySchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid war history payload", parsed.error.flatten());
    return context.json(presentHistory(await dependencies.service.createHistory(request, parsed.data)), 201);
  });

  routes.patch("/history/:id", async (context) => {
    const request = requestContext(context);
    const parsed = updateWarHistorySchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid war history payload", parsed.error.flatten());
    return context.json(presentHistory(await dependencies.service.updateHistory(
      request,
      context.req.param("id"),
      parsed.data,
    )));
  });

  routes.delete("/history/:id", async (context) => {
    const request = requestContext(context);
    await dependencies.service.deleteHistory(request, context.req.param("id"));
    return context.json(presentGuildWarOk());
  });

  routes.patch("/history/:id/member-stats/batch", async (context) => {
    const request = requestContext(context);
    const parsed = guildWarMemberStatsBatchSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid member stats payload", parsed.error.flatten());
    if (parsed.data.updates.length === 0) return context.json(presentMemberStats([]));
    const members = await dependencies.service.updateMemberStats(
      request,
      context.req.param("id"),
      parsed.data.updates.map((update) => ({ user_id: update.user_id, data: update.stats })),
    );
    return context.json(presentMemberStats(members));
  });

  routes.patch("/history/:id/member-stats/:userId", async (context) => {
    const request = requestContext(context);
    const parsed = updateMemberStatsSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid member stats payload", parsed.error.flatten());
    const member = (await dependencies.service.updateMemberStats(request, context.req.param("id"), [{
      user_id: context.req.param("userId"),
      data: parsed.data,
    }]))[0];
    if (!member) throw new AppError({ code: "SERVER_ERROR", status: 500, message: "Failed to load updated member stats" });
    return context.json(presentMember(member, true));
  });

  routes.get("/analytics", async (context) => context.json(presentAnalytics(
    await dependencies.service.analytics(
      requestContext(context),
      queryIds(context.req.queries("war_ids")),
      queryIds(context.req.queries("user_ids")),
    ),
  )));

  return routes;
}

function conditionalEtag(value: string | undefined): string | undefined {
  return value && value !== "*" ? value : undefined;
}

function queryIds(values: readonly string[] | undefined): string[] {
  return (values ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

async function jsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(request, z.unknown(), "Invalid JSON body");
}

function invalidPayload(message: string, details?: unknown, cause?: unknown): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    status: 400,
    message,
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
}
