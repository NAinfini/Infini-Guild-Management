import type { RequestContext } from "@guild/kernel";
import type { NotificationPublisher, DeferredTasks } from "@guild/kernel";
import type {
  EventClassQuota,
  EventClassQuotaInput,
  EventParticipant,
  RecurrenceRule,
} from "@guild/shared";
import type { EventType } from "@guild/shared/constants/event-types";
import type { PollResultsVisibility } from "@guild/shared/constants/events";
import type {
  AuditEventInput,
  AuditEventWrite as AuditMutation,
} from "@guild/server/modules/audit";

export type EventRecord = Readonly<{
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  capacity: number | null;
  pinned: boolean;
  signupLocked: boolean;
  autoArchive: boolean;
  autoArchived: boolean;
  visibleAt: string | null;
  archivedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  seriesId: string | null;
  instanceDate: string | null;
  winnerCount: number | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PollOptionRecord = Readonly<{
  id: string;
  label: string;
  sortOrder: number;
  voterIds: readonly string[];
}>;

export type EventPollRecord = Readonly<{
  resultsVisibility: PollResultsVisibility;
  showVoterNames: boolean;
  options: readonly PollOptionRecord[];
}>;

export type EventRaffleWinnerRecord = Readonly<{
  id: string;
  eventId: string;
  userId: string;
  drawnAt: string;
}>;

export type EventAggregate = Readonly<{
  event: EventRecord;
  attachments: readonly string[];
  classQuotas: readonly EventClassQuota[];
  poll: EventPollRecord | null;
  raffleWinners: readonly EventRaffleWinnerRecord[];
  participants: readonly EventParticipant[];
}>;

export type EventViewer = Readonly<{
  userId: string | null;
  canEdit: boolean;
  now: string;
}>;

export type EventViewerPollOption = Readonly<{
  id: string;
  label: string;
  sortOrder: number;
  voteCount: number;
  visibleVoterIds: readonly string[];
  votedByViewer: boolean;
}>;

export type EventViewerPoll = Readonly<{
  resultsVisibility: PollResultsVisibility;
  showVoterNames: boolean;
  viewerHasVoted: boolean;
  viewerCanVote: boolean;
  options: readonly EventViewerPollOption[];
}>;

export type EventViewerAggregate = Readonly<Omit<EventAggregate, "poll"> & {
  poll: EventViewerPoll | null;
}>;

export type RecurringTemplateRecord = Readonly<{
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  recurrenceRule: RecurrenceRule;
  visibilityOffsetMinutes: number;
  autoArchive: boolean;
  paused: boolean;
  createdBy: string;
  lastGeneratedDate: string | null;
  generationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type RecurringTemplateAggregate = Readonly<{
  template: RecurringTemplateRecord;
  attachments: readonly string[];
  classQuotas: readonly EventClassQuota[];
}>;

export type EventListQuery = Readonly<{
  page: number;
  limit: number;
  type?: string;
  archived?: boolean;
  pinned?: boolean;
  locked?: boolean;
  search?: string;
  startAfter?: string;
  startBefore?: string;
}>;

export type EventVisibilityScope = Readonly<{
  visibleAtOrBefore: string | null;
  includeHiddenGuildWars: boolean;
}>;

export type EventListResult = Readonly<{
  data: readonly EventAggregate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}>;

export type EventViewerListResult = Readonly<Omit<EventListResult, "data"> & {
  data: readonly EventViewerAggregate[];
}>;

export type OneTimeQuotaWrite = Readonly<{
  id: string;
  label: string;
  classIds: readonly string[];
}>;

export type EventQuotaWrite = Readonly<{
  tagId: string;
  required: number;
  oneTime: OneTimeQuotaWrite | null;
}>;

export type PollWrite = Readonly<{
  resultsVisibility: PollResultsVisibility;
  showVoterNames: boolean;
  options: readonly Readonly<{ id: string; label: string; sortOrder: number }>[];
}>;

export type EventCreateWrite = Readonly<{
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  capacity: number | null;
  autoArchive: boolean;
  winnerCount: number | null;
  actorUserId: string;
  now: string;
  quotas: readonly EventQuotaWrite[];
  poll: PollWrite | null;
  mediaIds: readonly string[];
  audit: AuditMutation;
}>;

export type EventUpdateWrite = Readonly<{
  eventId: string;
  actorUserId: string;
  now: string;
  patch: Readonly<Partial<{
    type: EventType;
    title: string;
    description: string | null;
    startAt: string;
    endAt: string | null;
    capacity: number | null;
    pinned: boolean;
    signupLocked: boolean;
    autoArchive: boolean;
    archivedAt: string | null;
    winnerCount: number | null;
  }>>;
  quotas?: readonly EventQuotaWrite[];
  poll?: PollWrite | null;
  mediaIds?: readonly string[];
  replacePollOptions: boolean;
  audit: AuditMutation;
}>;

export type TemplateCreateWrite = Readonly<{
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  startTime: string;
  durationMinutes: number | null;
  capacity: number | null;
  recurrenceRule: RecurrenceRule;
  visibilityOffsetMinutes: number;
  autoArchive: boolean;
  actorUserId: string;
  now: string;
  quotas: readonly EventQuotaWrite[];
  mediaIds: readonly string[];
  audit: AuditMutation;
}>;

export type TemplateUpdateWrite = Readonly<{
  templateId: string;
  actorUserId: string;
  now: string;
  patch: Readonly<Partial<{
    type: EventType;
    title: string;
    description: string | null;
    startTime: string;
    durationMinutes: number | null;
    capacity: number | null;
    recurrenceRule: RecurrenceRule;
    visibilityOffsetMinutes: number;
    autoArchive: boolean;
  }>>;
  quotas?: readonly EventQuotaWrite[];
  mediaIds?: readonly string[];
  restartCursorDate?: string;
  audit: AuditMutation;
}>;

export type RecurrenceMaterialization = Readonly<{
  templateId: string;
  eventIds: readonly string[];
  createdEventIds: readonly string[];
}>;

export type MaterializationAuditFactory = (input: AuditEventInput) => AuditMutation;

export interface EventsCatalogStore {
  list(query: EventListQuery, visibility: EventVisibilityScope): Promise<EventListResult>;
  get(eventId: string, includeParticipants?: boolean): Promise<EventAggregate | null>;
  getMany(eventIds: readonly string[], includeParticipants?: boolean): Promise<readonly EventAggregate[]>;
  create(input: EventCreateWrite): Promise<EventAggregate>;
  update(input: EventUpdateWrite): Promise<EventAggregate>;
  touch(eventId: string, actorUserId: string, now: string, mediaIds: readonly string[], audit: AuditMutation): Promise<void>;
}

export interface EventsLifecycleStore {
  setArchived(eventId: string, archivedAt: string, actorUserId: string, audit: AuditMutation): Promise<void>;
}

export type EventDestroyOutcome = "deleted" | "not_found" | "active_war_permission_required";

export interface EventGuildWarLifecycleStore {
  destroyEvent(input: Readonly<{
    eventId: string;
    allowActiveWarDelete: boolean;
    audit: AuditMutation;
  }>): Promise<EventDestroyOutcome>;
}

export interface EventsParticipationStore {
  addParticipants(eventId: string, userIds: readonly string[], participantIds: readonly string[], now: string, mode: "self" | "moderator", audit: AuditMutation): Promise<readonly EventParticipant[]>;
  removeParticipants(eventId: string, userIds: readonly string[], audit: AuditMutation): Promise<number>;
}

export interface EventsPollRaffleStore {
  replacePollVote(eventId: string, userId: string, optionIds: readonly string[], now: string, audit: AuditMutation): Promise<void>;
  drawRaffle(eventId: string, winnerIds: readonly string[], winnerRowIds: readonly string[], now: string, actorUserId: string, audit: AuditMutation): Promise<readonly EventRaffleWinnerRecord[]>;
}

export interface EventsRecurrenceStore {
  listTemplates(): Promise<readonly RecurringTemplateAggregate[]>;
  getTemplate(templateId: string): Promise<RecurringTemplateAggregate | null>;
  createTemplate(input: TemplateCreateWrite): Promise<RecurringTemplateAggregate>;
  updateTemplate(input: TemplateUpdateWrite): Promise<RecurringTemplateAggregate>;
  setTemplatePaused(
    templateId: string,
    paused: boolean,
    now: string,
    audit: AuditMutation,
    resumeCursorDate?: string,
  ): Promise<void>;
  deleteTemplate(templateId: string, audit: AuditMutation): Promise<void>;
  materializeDue(now: string, templateId: string | undefined, createAudit: MaterializationAuditFactory): Promise<readonly RecurrenceMaterialization[]>;
}

export type EventsStore = EventsCatalogStore
  & EventsLifecycleStore
  & EventsParticipationStore
  & EventsPollRaffleStore
  & EventsRecurrenceStore;

export interface EventMediaPort {
  list(entityType: "event" | "recurring_template", entityIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
}

export type EventsServiceDependencies = Readonly<{
  store: EventsStore;
  lifecycle: EventGuildWarLifecycleStore;
  media: EventMediaPort;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  createId?: () => string;
  random?: () => number;
}>;

export type EventMutationInput = Readonly<{
  type: EventType;
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  capacity?: number;
  attachments?: readonly string[];
  class_quotas?: readonly EventClassQuotaInput[];
  auto_archive?: boolean;
  poll?: Readonly<{
    options: readonly string[];
    results_visibility?: PollResultsVisibility;
    show_voter_names?: boolean;
  }>;
  winner_count?: number;
}>;

export type EventUpdateInput = Omit<Partial<EventMutationInput>, "description" | "end_at" | "capacity"> & Readonly<{
  description?: string | null;
  end_at?: string | null;
  capacity?: number | null;
  pinned?: boolean;
  signup_locked?: boolean;
  archived_at?: string | null;
}>;

export type TemplateMutationInput = Readonly<{
  type: EventType;
  title: string;
  description?: string;
  start_time: string;
  duration_minutes?: number;
  capacity?: number;
  recurrence_rule: RecurrenceRule;
  visibility_offset_minutes?: number;
  auto_archive?: boolean;
  attachments?: readonly string[];
  class_quotas?: readonly EventClassQuotaInput[];
}>;

export type TemplateUpdateInput = Omit<Partial<TemplateMutationInput>, "description" | "duration_minutes" | "capacity"> & Readonly<{
  description?: string | null;
  duration_minutes?: number | null;
  capacity?: number | null;
}>;

export type EventsRequestContext = RequestContext;
