import type {
  EventViewerAggregate,
  EventViewerListResult,
  RecurringTemplateAggregate,
} from "@guild/server/modules/events";
import {
  eventDetailSchema,
  eventDetailBatchSchema,
  eventListResponseSchema,
  eventMediaIdsResponseSchema,
  eventOkResponseSchema,
  eventParticipantListResponseSchema,
  eventParticipantRemovalResponseSchema,
  eventParticipantSchema,
  eventRaffleDrawResponseSchema,
  eventRaffleWinnerSchema,
  eventSchema,
  recurringTemplateListResponseSchema,
  recurringTemplateSchema,
} from "@guild/shared";

export function presentEvent(
  aggregate: EventViewerAggregate,
  includeParticipants = false,
) {
  const { event } = aggregate;
  const poll = aggregate.poll ? presentPoll(aggregate.poll) : undefined;
  const value = {
    id: event.id,
    type: event.type,
    title: event.title,
    description: event.description,
    start_at: event.startAt,
    end_at: event.endAt,
    capacity: event.capacity,
    pinned: event.pinned,
    signup_locked: event.signupLocked,
    auto_archive: event.autoArchive,
    auto_archived: event.autoArchived,
    visible_at: event.visibleAt,
    archived_at: event.archivedAt,
    created_by: event.createdBy,
    updated_by: event.updatedBy,
    attachments: [...aggregate.attachments],
    class_quotas: aggregate.classQuotas.map((quota) => ({ ...quota, class_ids: [...quota.class_ids] })),
    series_id: event.seriesId,
    instance_date: event.instanceDate,
    ...(poll === undefined ? {} : { poll }),
    ...(event.type === "raffle" ? {
      winner_count: event.winnerCount,
      raffle_winners: aggregate.raffleWinners.map(presentRaffleWinner),
    } : {}),
    created_at: event.createdAt,
    updated_at: event.updatedAt,
    ...(includeParticipants ? { participants: aggregate.participants.map(presentParticipant) } : {}),
  };
  return includeParticipants ? eventDetailSchema.parse(value) : eventSchema.parse(value);
}

export function presentEventList(result: EventViewerListResult) {
  return eventListResponseSchema.parse({
    data: result.data.map((event) => presentEvent(event)),
    total: result.total,
    page: result.page,
    limit: result.limit,
    total_pages: result.totalPages,
  });
}

export function presentEventDetailBatch(events: readonly EventViewerAggregate[]) {
  return eventDetailBatchSchema.parse({ data: events.map((event) => presentEvent(event, true)) });
}

export function presentTemplateList(templates: readonly RecurringTemplateAggregate[]) {
  return recurringTemplateListResponseSchema.parse({ data: templates.map(presentTemplate) });
}

export function presentEventOk() {
  return eventOkResponseSchema.parse({ ok: true });
}

export function presentEventMediaIds(mediaIds: readonly string[], updatedAt: string) {
  return eventMediaIdsResponseSchema.parse({ media_ids: mediaIds, updated_at: updatedAt });
}

export function presentParticipantList(participants: readonly EventViewerAggregate["participants"][number][]) {
  return eventParticipantListResponseSchema.parse({ data: participants.map(presentParticipant) });
}

export function presentParticipantRemoval(removed: number) {
  return eventParticipantRemovalResponseSchema.parse({ ok: true, removed });
}

export function presentRaffleDraw(winners: readonly EventViewerAggregate["raffleWinners"][number][]) {
  return eventRaffleDrawResponseSchema.parse({ data: winners.map(presentRaffleWinner) });
}

export function presentTemplate(aggregate: RecurringTemplateAggregate) {
  const { template } = aggregate;
  return recurringTemplateSchema.parse({
    id: template.id,
    type: template.type,
    title: template.title,
    description: template.description,
    start_time: template.startTime,
    duration_minutes: template.durationMinutes,
    capacity: template.capacity,
    recurrence_rule: template.recurrenceRule,
    visibility_offset_minutes: template.visibilityOffsetMinutes,
    auto_archive: template.autoArchive,
    attachments: [...aggregate.attachments],
    class_quotas: aggregate.classQuotas.map((quota) => ({ ...quota, class_ids: [...quota.class_ids] })),
    paused: template.paused,
    created_by: template.createdBy,
    last_generated_date: template.lastGeneratedDate,
    generation_count: template.generationCount,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  });
}

export function presentParticipant(participant: EventViewerAggregate["participants"][number]) {
  return eventParticipantSchema.parse({
    id: participant.id,
    event_id: participant.event_id,
    user_id: participant.user_id,
    joined_at: participant.joined_at,
  });
}

export function presentRaffleWinner(winner: EventViewerAggregate["raffleWinners"][number]) {
  return eventRaffleWinnerSchema.parse({
    id: winner.id,
    event_id: winner.eventId,
    user_id: winner.userId,
    drawn_at: winner.drawnAt,
  });
}

function presentPoll(poll: NonNullable<EventViewerAggregate["poll"]>) {
  return {
    results_visibility: poll.resultsVisibility,
    show_voter_names: poll.showVoterNames,
    has_voted: poll.viewerHasVoted,
    can_vote: poll.viewerCanVote,
    options: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      vote_count: option.voteCount,
      voter_ids: [...option.visibleVoterIds],
      voted_by_me: option.votedByViewer,
    })),
  };
}
