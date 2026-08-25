import type { DeferredTasks, NotificationPublisher, RequestContext } from "@guild/kernel";
import type {
  EventAggregate,
  EventViewerListResult,
} from "@guild/server/modules/events";
import type { AuditEventWrite as AuditMutation } from "@guild/server/modules/audit";
import type { PaginatedResponse, SiteAnalyticsSettings } from "@guild/shared";
import type {
  WarMemberStatKey,
  WarResult,
  WarTeamObjectiveKey,
} from "@guild/shared/constants/guild-war";

export type TeamStats = Readonly<Partial<Record<WarTeamObjectiveKey, number | null>>>;
export type MemberStats = Readonly<Partial<Record<WarMemberStatKey, number | null>>>;

export type GuildWarRecord = Readonly<{
  id: string;
  eventId: string | null;
  status: "active" | "concluded";
  warName: string;
  enemyName: string | null;
  result: WarResult | null;
  ownStats: TeamStats | null;
  enemyStats: TeamStats | null;
  durationMinutes: number | null;
  notes: string | null;
  rosterVersion: number;
  concludedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type WarMemberRecord = Readonly<{
  id: string;
  warId: string;
  teamId: string | null;
  userId: string;
  display_name: string;
  avatarMediaId: string | null;
  roleTag: string | null;
  sortOrder: number;
  stats: MemberStats | null;
  note: string | null;
}>;

export type WarTeamRecord = Readonly<{
  id: string;
  warId: string;
  teamName: string;
  sortOrder: number;
  notes: string | null;
  isLocked: boolean;
  members: readonly WarMemberRecord[];
}>;

export type GuildWarAggregate = Readonly<{
  war: GuildWarRecord;
  teams: readonly WarTeamRecord[];
  pool: readonly WarMemberRecord[];
}>;

export type HistoryListQuery = Readonly<{
  page: number;
  limit: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}>;

export type RosterTeamInput = Readonly<{
  id: string;
  teamName: string;
  sortOrder: number;
  notes: string | null;
  isLocked: boolean;
  members: readonly Readonly<{
    id: string;
    userId: string;
    roleTag: string | null;
    sortOrder: number;
  }>[];
}>;

export type RosterPoolInput = Readonly<{ id: string; userId: string; sortOrder: number }>;

export type HistoryPatch = Readonly<Partial<{
  eventId: string | null;
  warName: string;
  enemyName: string | null;
  result: WarResult;
  ownStats: TeamStats | null;
  enemyStats: TeamStats | null;
  durationMinutes: number | null;
  notes: string | null;
}>>;

export type AnalyticsRead = Readonly<{
  wars: readonly GuildWarRecord[];
  teamSizes: ReadonlyMap<string, number>;
  memberStats: readonly Readonly<{ userId: string; stats: MemberStats }>[];
}>;

export interface GuildWarStore {
  getByEvent(eventId: string): Promise<GuildWarAggregate | null>;
  /** 从给定用户中挑出还能站上进行中名册的那些；停用与已软删除的不返回。 */
  listRosterEligible(userIds: readonly string[]): Promise<readonly string[]>;
  getById(warId: string): Promise<GuildWarAggregate | null>;
  getMany(warIds: readonly string[]): Promise<readonly GuildWarAggregate[]>;
  getHistoryMany(warIds: readonly string[]): Promise<readonly GuildWarAggregate[]>;
  listHistory(query: HistoryListQuery): Promise<PaginatedResponse<GuildWarRecord>>;
  concludedEventIds(): Promise<readonly string[]>;
  createActive(input: Readonly<{
    id: string;
    eventId: string;
    warName: string;
    actorUserId: string;
    now: string;
    audit: AuditMutation;
  }>): Promise<boolean>;
  replaceRoster(input: Readonly<{
    warId: string;
    eventId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    teams: readonly RosterTeamInput[];
    pool: readonly RosterPoolInput[];
    audit: AuditMutation;
  }>): Promise<boolean>;
  setRoleTags(input: Readonly<{
    warId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    updates: readonly Readonly<{ userId: string; roleTag: string | null }>[];
    audit: AuditMutation;
  }>): Promise<boolean>;
  conclude(input: Readonly<{
    warId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    enemyName: string | null;
    result: WarResult;
    ownStats: TeamStats | null;
    enemyStats: TeamStats | null;
    durationMinutes: number | null;
    memberStats: readonly Readonly<{ userId: string; stats: MemberStats }>[];
    audit: AuditMutation;
  }>): Promise<boolean>;
  createHistory(input: Readonly<{ record: GuildWarRecord; audit: AuditMutation }>): Promise<boolean>;
  updateHistory(input: Readonly<{
    warId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    patch: HistoryPatch;
    audit: AuditMutation;
  }>): Promise<boolean>;
  deleteHistory(input: Readonly<{ warId: string; expectedVersion: number; audit: AuditMutation }>): Promise<boolean>;
  deleteHistories(input: Readonly<{
    rows: readonly Readonly<{ warId: string; expectedVersion: number; audit: AuditMutation }>[];
  }>): Promise<readonly string[]>;
  updateMemberStats(input: Readonly<{
    warId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    updates: readonly Readonly<{ userId: string; stats?: MemberStats; note?: string | null }>[];
    audit: AuditMutation;
  }>): Promise<boolean>;
  readAnalytics(warIds: readonly string[], userIds: readonly string[]): Promise<AnalyticsRead>;
  exportHistory(filters: Readonly<{ eventId?: string; dateFrom?: string; dateTo?: string }>): Promise<readonly GuildWarRecord[]>;
}

export interface GuildWarEventRosterStore {
  moveMembers(input: Readonly<{
    warId: string;
    eventId: string;
    expectedVersion: number;
    actorUserId: string;
    now: string;
    moves: readonly Readonly<{
      id: string;
      userId: string;
      to: string;
      participantId: string | null;
    }>[];
    audit: AuditMutation;
  }>): Promise<boolean>;
}

export interface GuildWarEventPort {
  findVisible(context: RequestContext, eventId: string): Promise<EventAggregate | null>;
  getGuildWarTarget(context: RequestContext, eventId: string): Promise<EventAggregate>;
  getGuildWarHistoryTarget(context: RequestContext, eventId: string): Promise<EventAggregate>;
  list(context: RequestContext, query: Readonly<{
    page: number;
    limit: number;
    type?: string;
    archived?: boolean;
    pinned?: boolean;
    locked?: boolean;
    search?: string;
    startAfter?: string;
    startBefore?: string;
  }>): Promise<EventViewerListResult>;
}

export interface AnalyticsSettingsReader {
  read(): Promise<SiteAnalyticsSettings>;
}

export type GuildWarServiceDependencies = Readonly<{
  store: GuildWarStore;
  eventRoster: GuildWarEventRosterStore;
  events: GuildWarEventPort;
  analyticsSettings: AnalyticsSettingsReader;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  createId?: () => string;
}>;
