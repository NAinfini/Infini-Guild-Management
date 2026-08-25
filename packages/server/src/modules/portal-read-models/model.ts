import type { RequestContext } from "@guild/kernel";
import type { EventAggregate, EventViewerAggregate } from "@guild/server/modules/events";
import type { GuildWarRecord } from "@guild/server/modules/guild-war";
import type { SearchResult } from "@guild/shared/schemas/portal-read-models";

export type DashboardParticipantRead = Readonly<{
  userId: string;
  display_name: string;
  roleId: string;
  classes: readonly string[];
  power: number;
  avatarMediaId: string | null;
}>;

export type DashboardQuotaSlotRead = Readonly<{
  tagId: string;
  required: number;
  matched: number;
  dedicated: number;
  eligible: number;
  floor: number;
  ceiling: number;
  status: "filled" | "flex" | "short";
}>;

export type DashboardQuotaSummaryRead = Readonly<{
  slots: readonly DashboardQuotaSlotRead[];
  benchedCount: number;
  unassignedCount: number;
  flexible: number;
  requiredTotal: number;
  matchedTotal: number;
  shortfall: number;
}>;

export type DashboardEventRead = Readonly<{
  aggregate: EventAggregate;
  participantCount: number;
  participantPreview: readonly DashboardParticipantRead[];
  quotaSummary: DashboardQuotaSummaryRead | null;
}>;

export type DashboardEventsRead = Readonly<{
  activeEventCount: number;
  featuredEvents: readonly DashboardEventRead[];
  upcomingEvents: readonly DashboardEventRead[];
  mySignupEventIds: readonly string[];
}>;

export type DashboardEventViewerRead = Readonly<Omit<DashboardEventRead, "aggregate"> & {
  aggregate: EventViewerAggregate;
}>;

export type DashboardEventsViewerRead = Readonly<Omit<
  DashboardEventsRead,
  "featuredEvents" | "upcomingEvents"
> & {
  featuredEvents: readonly DashboardEventViewerRead[];
  upcomingEvents: readonly DashboardEventViewerRead[];
}>;

export type DashboardWarMvpRead = Readonly<{
  category: string;
  label: string;
  name: string;
  initials: string;
  value: number;
}>;

export type DashboardWarsRead = Readonly<{
  allWarWinRate: number;
  recentWars: readonly GuildWarRecord[];
  recentWarMvps: readonly (readonly DashboardWarMvpRead[] | null)[];
}>;

export type DashboardExternalWarRead = Readonly<Pick<GuildWarRecord,
  | "id"
  | "eventId"
  | "warName"
  | "enemyName"
  | "result"
  | "ownStats"
  | "enemyStats"
  | "durationMinutes"
  | "createdAt"
  | "updatedAt"
>>;

export type DashboardWarsExternalRead = Readonly<{
  allWarWinRate: number;
  recentWars: readonly DashboardExternalWarRead[];
}>;

export type DashboardWarsViewerRead = DashboardWarsRead | DashboardWarsExternalRead;

export type SearchResultRead = Readonly<{
  id: string;
  title: string;
  subtitle: string;
  type: SearchResult["type"];
  to: string;
  entityId?: string;
  roleId?: string;
  roleName?: string;
  roleColor?: string | null;
  roleLevel?: number;
}>;

export interface PortalReadModelStore {
  dashboardMembers(): Promise<Readonly<{
    activeMemberCount: number;
    totalMemberCount: number;
  }>>;
  dashboardEvents(input: Readonly<{
    now: string;
    windowEnd: string;
    viewerUserId: string | null;
    canViewHidden: boolean;
  }>): Promise<DashboardEventsRead>;
  dashboardWars(): Promise<DashboardWarsRead>;
  search(input: Readonly<{
    query: string;
    limit: number;
    perTypeLimit: number;
    now: string;
  }>): Promise<readonly SearchResultRead[]>;
}

export type RuntimeHealthSnapshot = Readonly<{
  database: string;
  blob: string;
  realtime: string;
  scheduler: string;
}>;

export interface RuntimeHealthPort {
  read(context: RequestContext): Promise<RuntimeHealthSnapshot>;
}
