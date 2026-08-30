import {
  guildWarHistoryEtag,
  type GuildWarAggregate,
  type GuildWarActiveView,
  type GuildWarAnalytics,
  type GuildWarRecord,
  type WarMemberRecord,
  type WarTeamRecord,
} from "@guild/server/modules/guild-war";
import {
  guildWarActiveResponseSchema,
  guildWarAnalyticsResponseSchema,
  guildWarConcludeResponseSchema,
  guildWarConcludedEventIdsResponseSchema,
  guildWarHistoryBatchResponseSchema,
  guildWarHistoryDeleteBatchResponseSchema,
  guildWarHistoryDetailResponseSchema,
  guildWarHistoryListResponseSchema,
  guildWarMemberResponseSchema,
  guildWarMemberStatsResponseSchema,
  guildWarOkResponseSchema,
  guildWarRoleTagsResponseSchema,
  warHistorySchema,
} from "@guild/shared";
import { presentEvent } from "../events/events-presenter.js";

export function presentGuildWarActive(view: GuildWarActiveView) {
  return guildWarActiveResponseSchema.parse({
    war_history: null,
    event: view.event ? presentEvent(view.event) : null,
    teams: view.teams.map((team) => presentTeam(team, view.war, false)),
    pool: view.pool.map((member) => ({
      id: member.id,
      warHistoryId: null,
      eventId: view.event?.event.id ?? null,
      userId: member.userId,
      display_name: member.display_name,
      avatar_media_id: member.avatarMediaId,
    })),
    participants: view.participants.map((participant) => ({ ...participant })),
    etag: view.etag,
  });
}

export function presentHistory(war: GuildWarRecord) {
  return warHistorySchema.parse({
    id: war.id,
    event_id: war.eventId,
    war_name: war.warName,
    enemy_name: war.enemyName,
    result: war.result,
    own_stats: war.ownStats,
    enemy_stats: war.enemyStats,
    duration_minutes: war.durationMinutes,
    notes: war.notes,
    created_by: war.createdBy,
    updated_by: war.updatedBy,
    created_at: war.createdAt,
    updated_at: war.updatedAt,
  });
}

export function presentHistoryDetail(aggregate: GuildWarAggregate) {
  const members = aggregate.teams.flatMap((team) => team.members);
  return guildWarHistoryDetailResponseSchema.parse({
    ...presentHistory(aggregate.war),
    etag: guildWarHistoryEtag(aggregate.war),
    teams: aggregate.teams.map((team) => presentTeam(team, aggregate.war, true)),
    pool: aggregate.pool.map((member) => ({
      id: member.id,
      warHistoryId: aggregate.war.id,
      userId: member.userId,
      display_name: member.display_name,
    })),
    member_stats: members.map((member) => presentMember(member, true)),
  });
}

export function presentConcludedEventIds(eventIds: readonly string[]) {
  return guildWarConcludedEventIdsResponseSchema.parse({ data: eventIds });
}

export function presentGuildWarOk() {
  return guildWarOkResponseSchema.parse({ ok: true });
}

export function presentRoleTagsResult(updated: number) {
  return guildWarRoleTagsResponseSchema.parse({ ok: true, updated });
}

export function presentConcludeResult(warHistoryId: string) {
  return guildWarConcludeResponseSchema.parse({ war_history_id: warHistoryId });
}

export function presentHistoryList(result: Readonly<{
  data: readonly GuildWarRecord[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}>) {
  return guildWarHistoryListResponseSchema.parse({ ...result, data: result.data.map(presentHistory) });
}

export function presentHistoryBatch(wars: readonly GuildWarAggregate[]) {
  return guildWarHistoryBatchResponseSchema.parse({ data: wars.map(presentHistoryDetail) });
}

export function presentHistoryDeleteBatch(deleted: number) {
  return guildWarHistoryDeleteBatchResponseSchema.parse({ ok: true, deleted });
}

export function presentMemberStats(members: readonly WarMemberRecord[]) {
  return guildWarMemberStatsResponseSchema.parse({ data: members.map((member) => presentMember(member, true)) });
}

export function presentAnalytics(analytics: GuildWarAnalytics) {
  return guildWarAnalyticsResponseSchema.parse({
    wars: analytics.wars.map((war) => ({
      ...presentHistory(war),
      team_size: war.teamSize,
      modifier: war.modifier,
      modifier_breakdown: war.modifierBreakdown.map((item) => ({ ...item })),
    })),
    member_stats: analytics.memberStats.map((row) => ({ user_id: row.userId, stats: row.stats })),
    analytics_settings: analytics.settings,
  });
}

function presentTeam(team: WarTeamRecord, war: GuildWarRecord | null, history: boolean) {
  return {
    id: team.id,
    war_history_id: history ? war?.id ?? null : null,
    event_id: history ? null : war?.eventId ?? null,
    team_name: team.teamName,
    sort_order: team.sortOrder,
    notes: team.notes,
    is_locked: team.isLocked,
    members: team.members.map((member) => presentMember(member, history)),
  };
}

export function presentMember(member: WarMemberRecord, includeUsername = false) {
  return guildWarMemberResponseSchema.parse({
    id: member.id,
    war_team_id: member.teamId ?? "",
    user_id: member.userId,
    avatar_media_id: member.avatarMediaId,
    role_tag: member.roleTag,
    sort_order: member.sortOrder,
    stats: member.stats,
    note: member.note,
    ...(includeUsername ? { display_name: member.display_name } : {}),
  });
}
