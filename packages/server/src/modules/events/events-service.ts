import { nanoid } from "nanoid";
import { AppError, type AuthorizationContext, type RequestContext } from "@guild/kernel";
import type { PushHint } from "@guild/shared/constants/push-hints";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { createAuditMutation } from "@guild/server/modules/audit";
import type {
  EventAggregate,
  EventCreateWrite,
  EventListQuery,
  EventMutationInput,
  EventQuotaWrite,
  EventViewer,
  EventViewerAggregate,
  EventViewerListResult,
  EventsServiceDependencies,
  EventUpdateInput,
  EventUpdateWrite,
  EventVisibilityScope,
  PollWrite,
  RecurringTemplateAggregate,
  TemplateCreateWrite,
  TemplateMutationInput,
  TemplateUpdateInput,
  TemplateUpdateWrite,
} from "./model.js";
import { assertPortableLikeSearch } from "../../portable-search.js";

const MAX_EVENT_PAGE = 100;
const MAX_BATCH_DETAILS = 50;
const MAX_CATCH_UP = 10;

function appError(
  code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "SERVER_ERROR",
  status: 400 | 404 | 409 | 500,
  message: string,
  details?: unknown,
): AppError {
  return new AppError({ code, status, message, ...(details === undefined ? {} : { details }) });
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function eventVisibilityScope(
  authorization: AuthorizationContext,
  now: string,
): EventVisibilityScope {
  if (authorization.has(PERMISSION_ID.EVENTS_EDIT)) {
    return { visibleAtOrBefore: null, includeHiddenGuildWars: true };
  }
  return {
    visibleAtOrBefore: now,
    includeHiddenGuildWars: authorization.has(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT),
  };
}

export function canViewEvent(
  authorization: AuthorizationContext,
  event: EventAggregate["event"],
  now: string,
): boolean {
  if (authorization.has(PERMISSION_ID.EVENTS_EDIT)) return true;
  if (event.type === "guild_war" && authorization.has(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT)) return true;
  return event.visibleAt === null || event.visibleAt <= now;
}

export function eventViewer(context: RequestContext, externalView = false): EventViewer {
  return {
    userId: externalView ? null : context.authorization.actor?.userId ?? null,
    canEdit: !externalView && context.authorization.has(PERMISSION_ID.EVENTS_EDIT),
    now: context.now,
  };
}

export function projectEventForViewer(
  aggregate: EventAggregate,
  viewer: EventViewer,
): EventViewerAggregate {
  const poll = aggregate.poll;
  if (!poll) return { ...aggregate, poll: null };
  const voterIds = new Set(poll.options.flatMap((option) => option.voterIds));
  const viewerHasVoted = viewer.userId !== null && voterIds.has(viewer.userId);
  const closed = aggregate.event.endAt !== null && aggregate.event.endAt <= viewer.now;
  const resultsVisible = viewer.canEdit
    || poll.resultsVisibility === "always"
    || (poll.resultsVisibility === "after_vote" && viewerHasVoted)
    || (poll.resultsVisibility === "after_close" && closed);
  return {
    ...aggregate,
    poll: {
      resultsVisibility: poll.resultsVisibility,
      showVoterNames: poll.showVoterNames,
      viewerHasVoted,
      viewerCanVote: viewer.userId !== null && !closed,
      options: poll.options.map((option) => ({
        id: option.id,
        label: option.label,
        sortOrder: option.sortOrder,
        voteCount: resultsVisible ? option.voterIds.length : 0,
        visibleVoterIds: resultsVisible && (poll.showVoterNames || viewer.canEdit)
          ? [...option.voterIds]
          : [],
        votedByViewer: viewer.userId !== null && option.voterIds.includes(viewer.userId),
      })),
    },
  };
}

function assertPage(query: EventListQuery): void {
  if (!Number.isInteger(query.page) || query.page < 1) {
    throw appError("VALIDATION_ERROR", 400, "Invalid page");
  }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_EVENT_PAGE) {
    throw appError("VALIDATION_ERROR", 400, "Invalid limit");
  }
  if (query.startAfter && query.startBefore && query.startAfter > query.startBefore) {
    throw appError("VALIDATION_ERROR", 400, "Invalid event date range");
  }
}

function assertEventTimes(startAt: string, endAt: string | null): void {
  if (!Number.isFinite(Date.parse(startAt))) {
    throw appError("VALIDATION_ERROR", 400, "Invalid start_at");
  }
  if (endAt !== null && (!Number.isFinite(Date.parse(endAt)) || endAt <= startAt)) {
    throw appError("VALIDATION_ERROR", 400, "end_at must be after start_at");
  }
}

function assertActiveEvent(event: EventAggregate["event"]): void {
  if (event.archivedAt !== null) throw appError("CONFLICT", 409, "Event is archived");
}

export function selectRaffleWinnerIds(
  participantIds: readonly string[],
  winnerCount: number,
  random: () => number = Math.random,
): string[] {
  const shuffled = [...participantIds];
  const count = Math.min(winnerCount, shuffled.length);
  for (let index = 0; index < count; index += 1) {
    const remaining = shuffled.length - index;
    const offset = Math.min(remaining - 1, Math.floor(random() * remaining));
    const selected = index + offset;
    [shuffled[index], shuffled[selected]] = [shuffled[selected]!, shuffled[index]!];
  }
  return shuffled.slice(0, count);
}

function normalizeMediaIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
}

export class EventsService {
  private readonly createId: () => string;
  private readonly random: () => number;

  constructor(private readonly dependencies: EventsServiceDependencies) {
    this.createId = dependencies.createId ?? nanoid;
    this.random = dependencies.random ?? Math.random;
  }

  async list(context: RequestContext, query: EventListQuery): Promise<EventViewerListResult> {
    assertPage(query);
    assertPortableLikeSearch(query.search?.trim().toLowerCase(), "Event search");
    const result = await this.dependencies.store.list(
      query,
      eventVisibilityScope(context.authorization, context.now),
    );
    return { ...result, data: await this.projectMany(context, result.data) };
  }

  async detail(context: RequestContext, eventId: string): Promise<EventViewerAggregate> {
    const event = await this.dependencies.store.get(eventId, true);
    if (!event || !canViewEvent(context.authorization, event.event, context.now)) {
      throw appError("NOT_FOUND", 404, "Event not found");
    }
    return this.projectOne(context, event);
  }

  async batchDetails(context: RequestContext, eventIds: readonly string[]): Promise<readonly EventViewerAggregate[]> {
    const ids = [...new Set(eventIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_BATCH_DETAILS) {
      throw appError("VALIDATION_ERROR", 400, `Event ids must contain 1 to ${MAX_BATCH_DETAILS} items`);
    }
    const events = await this.dependencies.store.getMany(ids, true);
    const visible = events.filter((event) => canViewEvent(context.authorization, event.event, context.now));
    return this.projectMany(context, visible);
  }

  async findVisible(context: RequestContext, eventId: string): Promise<EventAggregate | null> {
    const event = await this.dependencies.store.get(eventId, true);
    if (!event || !canViewEvent(context.authorization, event.event, context.now)) return null;
    return this.attachOne(event);
  }

  async getGuildWarTarget(context: RequestContext, eventId: string): Promise<EventAggregate> {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    const event = await this.dependencies.store.get(eventId, true);
    if (!event || event.event.type !== "guild_war") {
      throw appError("NOT_FOUND", 404, "Guild war event not found");
    }
    return this.attachOne(event);
  }

  async getGuildWarHistoryTarget(context: RequestContext, eventId: string): Promise<EventAggregate> {
    context.authorization.require(PERMISSION_ID.GUILD_WAR_HISTORY_EDIT);
    const event = await this.dependencies.store.get(eventId, true);
    if (!event || event.event.type !== "guild_war") {
      throw appError("NOT_FOUND", 404, "Guild war event not found");
    }
    return this.attachOne(event);
  }

  async create(
    context: RequestContext,
    input: EventMutationInput,
  ): Promise<EventViewerAggregate> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_CREATE);
    const eventId = this.createId();
    const write = this.prepareCreate(context, actor.userId, eventId, input);
    const created = await this.dependencies.store.create(write);
    this.publish(eventId, "event_created", context.now);
    return this.projectOne(context, created);
  }

  async update(
    context: RequestContext,
    eventId: string,
    input: EventUpdateInput,
  ): Promise<EventViewerAggregate> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const existing = await this.requireEvent(eventId, true);
    const write = this.prepareUpdate(context, actor.userId, existing, input);
    const updated = await this.dependencies.store.update(write);
    this.publish(eventId, "event_updated", context.now);
    return this.projectOne(context, updated);
  }

  async archive(context: RequestContext, eventId: string): Promise<void> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_ARCHIVE);
    const existing = await this.requireEvent(eventId);
    if (existing.event.archivedAt !== null) return;
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: eventId,
      action: "archive",
      summary: existing.event.title,
    });
    await this.dependencies.store.setArchived(eventId, context.now, actor.userId, audit);
    this.publish(eventId, "event_archived", context.now);
  }

  async destroy(context: RequestContext, eventId: string): Promise<void> {
    context.authorization.require(PERMISSION_ID.EVENTS_DELETE);
    const existing = await this.requireEvent(eventId, true);
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: eventId,
      action: "delete",
      summary: existing.event.title,
    });
    const outcome = await this.dependencies.lifecycle.destroyEvent({
      eventId,
      allowActiveWarDelete: context.authorization.has(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT),
      audit,
    });
    if (outcome === "active_war_permission_required") {
      context.authorization.require(PERMISSION_ID.GUILD_WAR_TEAMS_EDIT);
    }
    if (outcome === "not_found") throw appError("NOT_FOUND", 404, "Event not found");
    this.publish(eventId, "event_deleted", context.now);
  }

  async uploadImages(
    context: RequestContext,
    eventId: string,
    mediaIds: readonly string[],
  ): Promise<readonly string[]> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const existing = await this.requireEvent(eventId, true);
    const next = normalizeMediaIds([...existing.attachments, ...mediaIds]);
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: eventId,
      action: "upload_images",
      summary: existing.event.title,
      details: { count: mediaIds.length },
    });
    await this.dependencies.store.touch(
      eventId,
      actor.userId,
      context.now,
      next,
      audit,
    );
    this.publish(eventId, "images_uploaded", context.now);
    return next;
  }

  async join(context: RequestContext, eventId: string) {
    const actor = context.authorization.requireAuthenticated();
    const event = await this.requireVisibleEvent(context, eventId);
    assertActiveEvent(event.event);
    if (event.event.type === "poll") throw appError("CONFLICT", 409, "Poll events do not use signups");
    if (event.event.signupLocked) throw appError("CONFLICT", 409, "Event signups are locked");
    const audit = createAuditMutation(context, {
      entityType: "event_participant",
      entityId: `${eventId}:${actor.userId}`,
      action: "join",
      summary: event.event.title,
    });
    const participants = await this.dependencies.store.addParticipants(
      eventId,
      [actor.userId],
      [this.createId()],
      context.now,
      "self",
      audit,
    );
    const participant = participants.find((row) => row.user_id === actor.userId);
    if (!participant) throw appError("SERVER_ERROR", 500, "Failed to load event signup");
    this.publish(eventId, "participant_joined", context.now);
    return participant;
  }

  async leave(context: RequestContext, eventId: string): Promise<void> {
    const actor = context.authorization.requireAuthenticated();
    const event = await this.requireVisibleEvent(context, eventId);
    assertActiveEvent(event.event);
    const audit = createAuditMutation(context, {
      entityType: "event_participant",
      entityId: `${eventId}:${actor.userId}`,
      action: "leave",
      summary: event.event.title,
    });
    const removed = await this.dependencies.store.removeParticipants(eventId, [actor.userId], audit);
    if (removed === 0) throw appError("NOT_FOUND", 404, "Event signup not found");
    this.publish(eventId, "participant_left", context.now);
  }

  async addParticipants(
    context: RequestContext,
    eventId: string,
    userIds: readonly string[],
  ) {
    context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const event = await this.requireEvent(eventId);
    assertActiveEvent(event.event);
    if (event.event.type === "poll") throw appError("CONFLICT", 409, "Poll events do not use signups");
    const ids = [...new Set(userIds)];
    const audit = createAuditMutation(context, {
      entityType: "event_participant",
      entityId: eventId,
      action: "batch_add_by_moderator",
      summary: event.event.title,
      details: { user_ids: ids },
    });
    const participants = await this.dependencies.store.addParticipants(
      eventId,
      ids,
      ids.map(() => this.createId()),
      context.now,
      "moderator",
      audit,
    );
    this.publish(eventId, "participants_added_by_moderator", context.now);
    return participants;
  }

  async removeParticipants(
    context: RequestContext,
    eventId: string,
    userIds: readonly string[],
  ): Promise<number> {
    context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const event = await this.requireEvent(eventId);
    const ids = [...new Set(userIds)];
    const audit = createAuditMutation(context, {
      entityType: "event_participant",
      entityId: eventId,
      action: "batch_remove_by_moderator",
      summary: event.event.title,
      details: { user_ids: ids },
    });
    const removed = await this.dependencies.store.removeParticipants(eventId, ids, audit);
    this.publish(eventId, "participants_removed_by_moderator", context.now);
    return removed;
  }

  async votePoll(
    context: RequestContext,
    eventId: string,
    optionIds: readonly string[],
  ): Promise<void> {
    const actor = context.authorization.requireAuthenticated();
    const event = await this.requireVisibleEvent(context, eventId);
    assertActiveEvent(event.event);
    if (event.event.type !== "poll" || !event.poll) throw appError("CONFLICT", 409, "Event is not a poll");
    if (!event.event.endAt || event.event.endAt <= context.now) throw appError("CONFLICT", 409, "Poll is closed");
    const ids = [...new Set(optionIds)];
    const valid = new Set(event.poll.options.map((option) => option.id));
    if (ids.length === 0 || ids.some((id) => !valid.has(id))) {
      throw appError("VALIDATION_ERROR", 400, "Invalid poll option");
    }
    const audit = createAuditMutation(context, {
      entityType: "event_poll_vote",
      entityId: `${eventId}:${actor.userId}`,
      action: "vote",
      summary: event.event.title,
      details: { option_count: ids.length },
    });
    await this.dependencies.store.replacePollVote(eventId, actor.userId, ids, context.now, audit);
    this.publish(eventId, "poll_voted", context.now);
  }

  async drawRaffle(context: RequestContext, eventId: string) {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_EDIT);
    const event = await this.requireEvent(eventId, true);
    assertActiveEvent(event.event);
    if (event.event.type !== "raffle") throw appError("CONFLICT", 409, "Event is not a raffle");
    if (event.raffleWinners.length > 0) throw appError("CONFLICT", 409, "Raffle winners already drawn");
    if (!event.event.winnerCount) throw appError("VALIDATION_ERROR", 400, "Raffle has no winner_count configured");
    if (event.participants.length === 0) throw appError("VALIDATION_ERROR", 400, "No participants to draw from");

    const winners = selectRaffleWinnerIds(
      event.participants.map((participant) => participant.user_id),
      event.event.winnerCount,
      this.random,
    );
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: eventId,
      action: "raffle_draw",
      summary: event.event.title,
      details: { winner_user_ids: winners },
    });
    const result = await this.dependencies.store.drawRaffle(
      eventId,
      winners,
      winners.map(() => this.createId()),
      context.now,
      actor.userId,
      audit,
    );
    this.publish(eventId, "raffle_drawn", context.now);
    return result;
  }

  async listTemplates(context: RequestContext): Promise<readonly RecurringTemplateAggregate[]> {
    context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    return this.attachTemplateMedia(await this.dependencies.store.listTemplates());
  }

  async createTemplate(
    context: RequestContext,
    input: TemplateMutationInput,
  ): Promise<RecurringTemplateAggregate> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    this.assertTemplateType(input.type);
    const templateId = this.createId();
    const audit = createAuditMutation(context, {
      entityType: "recurring_template",
      entityId: templateId,
      action: "create",
      summary: input.title,
    });
    const write: TemplateCreateWrite = {
      id: templateId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      startTime: input.start_time,
      durationMinutes: input.duration_minutes ?? null,
      capacity: input.capacity ?? null,
      recurrenceRule: input.recurrence_rule,
      visibilityOffsetMinutes: input.visibility_offset_minutes ?? 0,
      autoArchive: input.auto_archive ?? false,
      actorUserId: actor.userId,
      now: context.now,
      quotas: this.prepareQuotas(input.class_quotas ?? []),
      mediaIds: normalizeMediaIds(input.attachments),
      audit,
    };
    const created = await this.dependencies.store.createTemplate(write);
    await this.materializeDue(context, templateId);
    return this.attachTemplateOne(created);
  }

  async updateTemplate(
    context: RequestContext,
    templateId: string,
    input: TemplateUpdateInput,
  ): Promise<RecurringTemplateAggregate> {
    const actor = context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    const existing = await this.requireTemplate(templateId);
    const effectiveType = input.type ?? existing.template.type;
    this.assertTemplateType(effectiveType);
    const recurrenceChanged = hasOwn(input, "recurrence_rule") || hasOwn(input, "start_time");
    const audit = createAuditMutation(context, {
      entityType: "recurring_template",
      entityId: templateId,
      action: "update",
      summary: input.title ?? existing.template.title,
    });
    const patch: TemplateUpdateWrite["patch"] = {
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.start_time === undefined ? {} : { startTime: input.start_time }),
      ...(input.duration_minutes === undefined ? {} : { durationMinutes: input.duration_minutes }),
      ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
      ...(input.recurrence_rule === undefined ? {} : { recurrenceRule: input.recurrence_rule }),
      ...(input.visibility_offset_minutes === undefined ? {} : { visibilityOffsetMinutes: input.visibility_offset_minutes }),
      ...(input.auto_archive === undefined ? {} : { autoArchive: input.auto_archive }),
    };
    const write: TemplateUpdateWrite = {
      templateId,
      actorUserId: actor.userId,
      now: context.now,
      patch,
      ...(input.class_quotas === undefined
        ? {}
        : { quotas: this.prepareQuotas(input.class_quotas) }),
      ...(hasOwn(input, "attachments") ? { mediaIds: normalizeMediaIds(input.attachments) } : {}),
      resetGeneration: recurrenceChanged,
      audit,
    };
    const updated = await this.dependencies.store.updateTemplate(write);
    await this.materializeDue(context, templateId);
    return this.attachTemplateOne(updated);
  }

  async pauseTemplate(context: RequestContext, templateId: string): Promise<void> {
    context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    const template = await this.requireTemplate(templateId);
    const audit = createAuditMutation(context, {
      entityType: "recurring_template",
      entityId: templateId,
      action: "pause",
      summary: template.template.title,
    });
    await this.dependencies.store.setTemplatePaused(templateId, true, context.now, audit);
  }

  async resumeTemplate(context: RequestContext, templateId: string): Promise<void> {
    context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    const template = await this.requireTemplate(templateId);
    const audit = createAuditMutation(context, {
      entityType: "recurring_template",
      entityId: templateId,
      action: "resume",
      summary: template.template.title,
    });
    await this.dependencies.store.setTemplatePaused(templateId, false, context.now, audit);
    await this.materializeDue(context, templateId);
  }

  async deleteTemplate(context: RequestContext, templateId: string): Promise<void> {
    context.authorization.require(PERMISSION_ID.EVENTS_TEMPLATES);
    const template = await this.requireTemplate(templateId);
    const audit = createAuditMutation(context, {
      entityType: "recurring_template",
      entityId: templateId,
      action: "delete",
      summary: template.template.title,
    });
    await this.dependencies.store.deleteTemplate(templateId, audit);
  }

  async materializeDue(context: RequestContext, templateId?: string): Promise<void> {
    const materialized = await this.dependencies.store.materializeDue(
      context.now,
      templateId,
      (eventId, eventTitle, sourceTemplateId) => createAuditMutation(context, {
        entityType: "event",
        entityId: eventId,
        action: "create",
        summary: eventTitle,
        details: { recurring_template_id: sourceTemplateId },
      }),
    );
    for (const result of materialized) {
      for (const eventId of result.createdEventIds.slice(0, MAX_CATCH_UP)) {
        this.publish(eventId, "event_created", context.now);
      }
    }
  }

  private prepareCreate(
    context: RequestContext,
    actorUserId: string,
    eventId: string,
    input: EventMutationInput,
  ): EventCreateWrite {
    assertEventTimes(input.start_at, input.end_at ?? null);
    const poll = input.type === "poll" ? this.preparePoll(input.poll) : null;
    if (input.type === "poll" && !poll) throw appError("VALIDATION_ERROR", 400, "Poll events require poll settings");
    if (input.type === "raffle" && !input.winner_count) {
      throw appError("VALIDATION_ERROR", 400, "Raffle events require winner_count");
    }
    if ((input.type === "poll" || input.type === "raffle") && (input.class_quotas?.length ?? 0) > 0) {
      throw appError("VALIDATION_ERROR", 400, `${input.type} events do not use class quotas`);
    }
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: eventId,
      action: "create",
      summary: input.title,
    });
    return {
      id: eventId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      startAt: input.start_at,
      endAt: input.end_at ?? null,
      capacity: input.type === "poll" ? null : input.capacity ?? null,
      autoArchive: input.auto_archive ?? false,
      winnerCount: input.type === "raffle" ? input.winner_count ?? null : null,
      actorUserId,
      now: context.now,
      quotas: this.prepareQuotas(input.class_quotas ?? []),
      poll,
      mediaIds: normalizeMediaIds(input.attachments),
      audit,
    };
  }

  private prepareUpdate(
    context: RequestContext,
    actorUserId: string,
    existing: EventAggregate,
    input: EventUpdateInput,
  ): EventUpdateWrite {
    const type = input.type ?? existing.event.type;
    const startAt = input.start_at ?? existing.event.startAt;
    const endAt = input.end_at ?? existing.event.endAt;
    assertEventTimes(startAt, endAt);
    const currentHasVotes = existing.poll?.options.some((option) => option.voterIds.length > 0) ?? false;
    const nextPoll = input.poll === undefined
      ? existing.poll === null
        ? null
        : {
            resultsVisibility: existing.poll.resultsVisibility,
            showVoterNames: existing.poll.showVoterNames,
            options: existing.poll.options.map(({ id, label, sortOrder }) => ({ id, label, sortOrder })),
          }
      : this.preparePoll(input.poll);
    if (type === "poll" && !nextPoll) throw appError("VALIDATION_ERROR", 400, "Poll events require poll settings");
    if (type === "poll" && endAt === null) throw appError("VALIDATION_ERROR", 400, "Poll events require end_at");
    if (type === "raffle" && endAt === null) throw appError("VALIDATION_ERROR", 400, "Raffle events require end_at");
    const winnerCount = type === "raffle"
      ? input.winner_count ?? existing.event.winnerCount
      : null;
    if (type === "raffle" && !winnerCount) throw appError("VALIDATION_ERROR", 400, "Raffle events require winner_count");
    if ((type === "poll" || type === "raffle") && (input.class_quotas?.length ?? 0) > 0) {
      throw appError("VALIDATION_ERROR", 400, `${type} events do not use class quotas`);
    }

    const requestedLabels = input.poll?.options.map((label) => label.trim());
    const existingLabels = existing.poll?.options.map((option) => option.label) ?? [];
    const replacePollOptions = requestedLabels !== undefined
      && JSON.stringify(requestedLabels) !== JSON.stringify(existingLabels);
    const behaviorChanged = type !== existing.event.type;
    if (currentHasVotes && (replacePollOptions || behaviorChanged)) {
      throw appError("CONFLICT", 409, "Poll options cannot change after voting starts");
    }
    if (existing.raffleWinners.length > 0 && (behaviorChanged || input.winner_count !== undefined)) {
      throw appError("CONFLICT", 409, "Raffle type and winner_count cannot change after winners are drawn");
    }

    const patch: EventUpdateWrite["patch"] = {
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.start_at === undefined ? {} : { startAt: input.start_at }),
      ...(input.end_at === undefined ? {} : { endAt: input.end_at }),
      ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.signup_locked === undefined ? {} : { signupLocked: input.signup_locked }),
      ...(input.auto_archive === undefined ? {} : { autoArchive: input.auto_archive }),
      ...(input.archived_at === undefined ? {} : { archivedAt: input.archived_at }),
      ...(input.winner_count === undefined && !behaviorChanged ? {} : { winnerCount }),
      ...(type === "poll" ? { capacity: null, winnerCount: null } : {}),
      ...(type !== "raffle" ? { winnerCount: null } : {}),
    };
    const audit = createAuditMutation(context, {
      entityType: "event",
      entityId: existing.event.id,
      action: "update",
      summary: input.title ?? existing.event.title,
    });
    return {
      eventId: existing.event.id,
      actorUserId,
      now: context.now,
      patch,
      ...(input.class_quotas === undefined
        ? {}
        : { quotas: this.prepareQuotas(input.class_quotas) }),
      ...(input.poll === undefined && !behaviorChanged
        ? {}
        : { poll: type === "poll" ? nextPoll : null }),
      ...(hasOwn(input, "attachments") ? { mediaIds: normalizeMediaIds(input.attachments) } : {}),
      replacePollOptions,
      audit,
    };
  }

  private preparePoll(input: EventMutationInput["poll"]): PollWrite | null {
    if (!input) return null;
    return {
      resultsVisibility: input.results_visibility ?? "after_vote",
      showVoterNames: input.show_voter_names ?? false,
      options: input.options.map((label, sortOrder) => ({ id: this.createId(), label: label.trim(), sortOrder })),
    };
  }

  private prepareQuotas(
    inputs: NonNullable<EventMutationInput["class_quotas"]>,
  ): EventQuotaWrite[] {
    return inputs.map((quota) => {
      if ("tag_id" in quota) return { tagId: quota.tag_id, required: quota.required, oneTime: null };
      const id = this.createId();
      return {
        tagId: id,
        required: quota.required,
        oneTime: { id, label: quota.tag.label, classIds: quota.tag.class_ids },
      };
    });
  }

  private assertTemplateType(type: string): void {
    if (type === "poll" || type === "raffle") {
      throw appError("VALIDATION_ERROR", 400, "Poll and raffle events cannot use recurring templates");
    }
  }

  private async requireEvent(eventId: string, includeParticipants = false): Promise<EventAggregate> {
    const event = await this.dependencies.store.get(eventId, includeParticipants);
    if (!event) throw appError("NOT_FOUND", 404, "Event not found");
    return this.attachOne(event);
  }

  private async requireVisibleEvent(context: RequestContext, eventId: string): Promise<EventAggregate> {
    const event = await this.requireEvent(eventId, true);
    if (!canViewEvent(context.authorization, event.event, context.now)) {
      throw appError("NOT_FOUND", 404, "Event not found");
    }
    return event;
  }

  private async requireTemplate(templateId: string): Promise<RecurringTemplateAggregate> {
    const template = await this.dependencies.store.getTemplate(templateId);
    if (!template) throw appError("NOT_FOUND", 404, "Template not found");
    return this.attachTemplateOne(template);
  }

  private async attachOne(event: EventAggregate): Promise<EventAggregate> {
    return (await this.attachMedia([event]))[0]!;
  }

  private async projectOne(
    context: RequestContext,
    event: EventAggregate,
  ): Promise<EventViewerAggregate> {
    return (await this.projectMany(context, [event]))[0]!;
  }

  private async projectMany(
    context: RequestContext,
    events: readonly EventAggregate[],
  ): Promise<readonly EventViewerAggregate[]> {
    const viewer = eventViewer(context);
    return (await this.attachMedia(events)).map((event) => projectEventForViewer(event, viewer));
  }

  private async attachMedia(events: readonly EventAggregate[]): Promise<readonly EventAggregate[]> {
    if (events.length === 0) return events;
    const attachments = await this.dependencies.media.list("event", events.map(({ event }) => event.id));
    return events.map((aggregate) => ({
      ...aggregate,
      attachments: attachments.get(aggregate.event.id) ?? [],
    }));
  }

  private async attachTemplateOne(template: RecurringTemplateAggregate): Promise<RecurringTemplateAggregate> {
    return (await this.attachTemplateMedia([template]))[0]!;
  }

  private async attachTemplateMedia(
    templates: readonly RecurringTemplateAggregate[],
  ): Promise<readonly RecurringTemplateAggregate[]> {
    if (templates.length === 0) return templates;
    const attachments = await this.dependencies.media.list(
      "recurring_template",
      templates.map(({ template }) => template.id),
    );
    return templates.map((aggregate) => ({
      ...aggregate,
      attachments: attachments.get(aggregate.template.id) ?? [],
    }));
  }

  private publish(entityId: string, hint: PushHint, updatedAt: string): void {
    this.dependencies.deferred.defer(() => this.dependencies.notifications.publish({
      type: "entity_changed",
      entity_type: "event",
      entity_id: entityId,
      updated_at: updatedAt,
      hint,
    }));
  }
}
