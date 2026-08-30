import { AppError, type PermissionId, type RequestContext } from "@guild/kernel";
import type { EventsService } from "@guild/server/modules/events";
import {
  createEventSchema,
  createTemplateSchema,
  eventIdsBatchSchema,
  eventParticipantsBatchSchema,
  pollVoteSchema,
  updateEventSchema,
  updateTemplateSchema,
} from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { LIMITS, MAX_OFFSET_PAGE } from "@guild/shared/config/limits";
import { Hono } from "hono";
import { z } from "zod";
import { parseFormData, parseJsonBody, type ParsedMultipartForm } from "../../core/parsing.js";
import {
  presentEvent,
  presentEventDetailBatch,
  presentEventMediaIds,
  presentEventList,
  presentEventOk,
  presentParticipant,
  presentParticipantList,
  presentParticipantRemoval,
  presentRaffleDraw,
  presentTemplate,
  presentTemplateList,
} from "../../presenters/events/events-presenter.js";

type EventsHttpEnv = {
  Variables: { requestContext: RequestContext };
};

export type EventsRouteDependencies = Readonly<{
  service: EventsService;
  stageEventImages(context: RequestContext, form: ParsedMultipartForm): Promise<readonly string[]>;
}>;

export function createEventsRoutes(dependencies: EventsRouteDependencies): Hono<EventsHttpEnv> {
  const routes = new Hono<EventsHttpEnv>();
  const requestContext = (context: { get(key: "requestContext"): RequestContext }) => context.get("requestContext");

  routes.get("/", async (context) => {
    const request = requestContext(context);
    return context.json(presentEventList(await dependencies.service.list(request, {
      page: integerQuery(context.req.query("page"), 1, MAX_OFFSET_PAGE, "page"),
      limit: integerQuery(context.req.query("limit"), 20, LIMITS.pagination.events, "limit"),
      ...(context.req.query("type") ? { type: context.req.query("type")! } : {}),
      ...optionalBooleanQuery("archived", context.req.query("archived")),
      ...optionalBooleanQuery("pinned", context.req.query("pinned")),
      ...optionalBooleanQuery("locked", context.req.query("locked")),
      ...(context.req.query("search")?.trim() ? { search: context.req.query("search")!.trim() } : {}),
      ...(context.req.query("start_after") ? { startAfter: context.req.query("start_after")! } : {}),
      ...(context.req.query("start_before") ? { startBefore: context.req.query("start_before")! } : {}),
    })));
  });

  routes.post("/batch-details", async (context) => {
    const request = requestContext(context);
    const parsed = eventIdsBatchSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid event ids payload", parsed.error.flatten());
    if (parsed.data.ids.length === 0) return context.json(presentEventDetailBatch([]));
    const events = await dependencies.service.batchDetails(request, parsed.data.ids);
    return context.json(presentEventDetailBatch(events));
  });

  routes.get("/templates/list", async (context) => {
    const request = requestContext(context);
    return context.json(presentTemplateList(await dependencies.service.listTemplates(request)));
  });

  routes.post("/templates", async (context) => {
    const request = requestContext(context);
    const { body, uploaded } = await imageMutationBody(
      context.req.raw, request, PERMISSION_ID.EVENTS_TEMPLATES, dependencies.stageEventImages,
    );
    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) throw invalidPayload("Invalid template payload", parsed.error.flatten());
    const input = uploaded.length === 0
      ? parsed.data
      : { ...parsed.data, attachments: [...(parsed.data.attachments ?? []), ...uploaded] };
    return context.json(presentTemplate(await dependencies.service.createTemplate(request, input)), 201);
  });

  routes.patch("/templates/:id", async (context) => {
    const request = requestContext(context);
    const { body, uploaded } = await imageMutationBody(
      context.req.raw, request, PERMISSION_ID.EVENTS_TEMPLATES, dependencies.stageEventImages,
    );
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) throw invalidPayload("Invalid template update payload", parsed.error.flatten());
    const input = uploaded.length === 0
      ? parsed.data
      : { ...parsed.data, attachments: [...(parsed.data.attachments ?? []), ...uploaded] };
    return context.json(presentTemplate(await dependencies.service.updateTemplate(
      request,
      context.req.param("id"),
      input,
    )));
  });

  routes.post("/templates/:id/pause", async (context) => {
    const request = requestContext(context);
    await dependencies.service.pauseTemplate(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.post("/templates/:id/resume", async (context) => {
    const request = requestContext(context);
    await dependencies.service.resumeTemplate(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.delete("/templates/:id", async (context) => {
    const request = requestContext(context);
    await dependencies.service.deleteTemplate(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.post("/", async (context) => {
    const request = requestContext(context);
    const { body, uploaded } = await imageMutationBody(
      context.req.raw, request, PERMISSION_ID.EVENTS_CREATE, dependencies.stageEventImages,
    );
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) throw invalidPayload("Invalid create event payload", parsed.error.flatten());
    const input = uploaded.length === 0
      ? parsed.data
      : { ...parsed.data, attachments: [...(parsed.data.attachments ?? []), ...uploaded] };
    return context.json(presentEvent(await dependencies.service.create(request, input)), 201);
  });

  routes.get("/:id", async (context) => {
    const request = requestContext(context);
    return context.json(presentEvent(await dependencies.service.detail(request, context.req.param("id")), true));
  });

  routes.patch("/:id", async (context) => {
    const request = requestContext(context);
    const { body, uploaded } = await imageMutationBody(
      context.req.raw, request, PERMISSION_ID.EVENTS_EDIT, dependencies.stageEventImages,
    );
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) throw invalidPayload("Invalid update event payload", parsed.error.flatten());
    const input = uploaded.length === 0
      ? parsed.data
      : { ...parsed.data, attachments: [...(parsed.data.attachments ?? []), ...uploaded] };
    return context.json(presentEvent(await dependencies.service.update(request, context.req.param("id"), input)));
  });

  routes.delete("/:id", async (context) => {
    const request = requestContext(context);
    await dependencies.service.archive(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.delete("/:id/destroy", async (context) => {
    const request = requestContext(context);
    await dependencies.service.destroy(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.post("/:id/images", async (context) => {
    const request = requestContext(context);
    request.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    let form: ParsedMultipartForm;
    try {
      form = await parseFormData(context.req.raw);
    } catch (cause) {
      throw invalidPayload("Invalid or missing form data", undefined, cause);
    }
    const revision = z.string().datetime().safeParse(form.get("expected_updated_at"));
    if (!revision.success) throw invalidPayload("Invalid or missing event revision", revision.error.flatten());
    const mediaIds = await dependencies.stageEventImages(request, form);
    const uploaded = await dependencies.service.uploadImages(request, context.req.param("id"), mediaIds, revision.data);
    return context.json(presentEventMediaIds(uploaded.mediaIds, uploaded.updatedAt), 201);
  });

  routes.post("/:id/join", async (context) => {
    const request = requestContext(context);
    return context.json(presentParticipant(await dependencies.service.join(request, context.req.param("id"))), 201);
  });

  routes.delete("/:id/leave", async (context) => {
    const request = requestContext(context);
    await dependencies.service.leave(request, context.req.param("id"));
    return context.json(presentEventOk());
  });

  routes.post("/:id/poll/vote", async (context) => {
    const request = requestContext(context);
    const parsed = pollVoteSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid poll vote payload", parsed.error.flatten());
    await dependencies.service.votePoll(request, context.req.param("id"), parsed.data.option_ids);
    return context.json(presentEventOk());
  });

  routes.post("/:id/raffle/draw", async (context) => {
    const request = requestContext(context);
    return context.json(presentRaffleDraw(
      await dependencies.service.drawRaffle(request, context.req.param("id")),
    ));
  });

  routes.post("/:id/participants", async (context) => {
    const request = requestContext(context);
    const parsed = eventParticipantsBatchSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid participant payload", parsed.error.flatten());
    const participants = await dependencies.service.addParticipants(request, context.req.param("id"), parsed.data.user_ids);
    return context.json(presentParticipantList(participants), 201);
  });

  routes.delete("/:id/participants", async (context) => {
    const request = requestContext(context);
    const parsed = eventParticipantsBatchSchema.safeParse(await jsonBody(context.req.raw));
    if (!parsed.success) throw invalidPayload("Invalid participant payload", parsed.error.flatten());
    const removed = await dependencies.service.removeParticipants(request, context.req.param("id"), parsed.data.user_ids);
    return context.json(presentParticipantRemoval(removed));
  });

  return routes;
}

async function imageMutationBody(
  rawRequest: Request,
  context: RequestContext,
  permission: PermissionId,
  stageImages: EventsRouteDependencies["stageEventImages"],
): Promise<{ body: unknown; uploaded: readonly string[] }> {
  if (!rawRequest.headers.get("content-type")?.includes("multipart/form-data")) {
    return { body: await jsonBody(rawRequest), uploaded: [] };
  }
  context.authorization.require(permission);
  let form: ParsedMultipartForm;
  try {
    form = await parseFormData(rawRequest);
  } catch (cause) {
    throw invalidPayload("Invalid or missing form data", undefined, cause);
  }
  const raw = form.get("data");
  if (typeof raw !== "string" || !raw.trim()) throw invalidPayload("Missing data payload");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (cause) {
    throw invalidPayload("Invalid JSON body", undefined, cause);
  }
  return { body, uploaded: await stageImages(context, form) };
}

async function jsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(request, z.unknown(), "Invalid JSON body");
}

function integerQuery(value: string | undefined, fallback: number, maximum: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw invalidPayload(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function optionalBooleanQuery(key: "archived" | "pinned" | "locked", value: string | undefined) {
  if (value === undefined) return {};
  if (value !== "true" && value !== "false") throw invalidPayload(`${key} must be true or false`);
  return { [key]: value === "true" };
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
