import type {
  DashboardEventsViewerRead,
  DashboardWarsViewerRead,
  RuntimeHealthSnapshot,
  SearchResultRead,
} from "@guild/server/modules/portal-read-models";
import {
  adminStatusSchema,
  dashboardEventsResponseSchema,
  dashboardMemberStatsResponseSchema,
  dashboardWarsExternalResponseSchema,
  dashboardWarsResponseSchema,
  searchResponseSchema,
} from "@guild/shared/schemas/portal-read-models";
import { presentEvent } from "../events/events-presenter.js";
import { presentHistory } from "../guild-war/guild-war-presenter.js";

export function presentDashboardMembers(value: Readonly<{
  activeMemberCount: number;
  totalMemberCount: number;
}>) {
  return dashboardMemberStatsResponseSchema.parse({
    active_member_count: value.activeMemberCount,
    total_member_count: value.totalMemberCount,
  });
}

export function presentDashboardEvents(value: DashboardEventsViewerRead) {
  const present = (item: DashboardEventsViewerRead["upcomingEvents"][number]) => ({
    ...presentEvent(item.aggregate),
    participant_count: item.participantCount,
    participant_preview: item.participantPreview.map((participant) => ({
      user_id: participant.userId,
      username: participant.username,
      role: participant.roleId,
      classes: [...participant.classes],
      power: participant.power,
      avatar_media_id: participant.avatarMediaId,
    })),
    quota_summary: item.quotaSummary && {
      slots: item.quotaSummary.slots.map((slot) => ({
        tag_id: slot.tagId,
        required: slot.required,
        matched: slot.matched,
        dedicated: slot.dedicated,
        eligible: slot.eligible,
        floor: slot.floor,
        ceiling: slot.ceiling,
        status: slot.status,
      })),
      benched_count: item.quotaSummary.benchedCount,
      unassigned_count: item.quotaSummary.unassignedCount,
      flexible: item.quotaSummary.flexible,
      required_total: item.quotaSummary.requiredTotal,
      matched_total: item.quotaSummary.matchedTotal,
      shortfall: item.quotaSummary.shortfall,
    },
  });
  return dashboardEventsResponseSchema.parse({
    active_events_count: value.activeEventCount,
    featured_events: value.featuredEvents.map(present),
    upcoming_events: value.upcomingEvents.map(present),
    my_signup_event_ids: [...value.mySignupEventIds],
  });
}

export function presentDashboardWars(value: DashboardWarsViewerRead) {
  if ("recentWarMvps" in value) {
    return dashboardWarsResponseSchema.parse({
      all_war_win_rate: value.allWarWinRate,
      recent_wars: value.recentWars.map(presentHistory),
      recent_war_mvps: value.recentWarMvps.map((entries) => entries?.map((entry) => ({
        category: entry.category,
        label: entry.label,
        name: entry.name,
        initials: entry.initials,
        value: entry.value,
      })) ?? null),
    });
  }
  return dashboardWarsExternalResponseSchema.parse({
    all_war_win_rate: value.allWarWinRate,
    recent_wars: value.recentWars.map((war) => ({
      id: war.id,
      event_id: war.eventId,
      war_name: war.warName,
      enemy_name: war.enemyName,
      result: war.result,
      own_stats: war.ownStats,
      enemy_stats: war.enemyStats,
      duration_minutes: war.durationMinutes,
      created_at: war.createdAt,
      updated_at: war.updatedAt,
    })),
  });
}

export function presentSearch(results: readonly SearchResultRead[]) {
  return searchResponseSchema.parse({
    data: results.map((result) => ({
      id: result.id,
      title: result.title,
      subtitle: result.subtitle,
      type: result.type,
      to: result.to,
      ...(result.entityId === undefined ? {} : { entity_id: result.entityId }),
      ...(result.roleId === undefined ? {} : { role: result.roleId }),
      ...(result.roleName === undefined ? {} : { role_name: result.roleName }),
      ...(result.roleColor === undefined ? {} : { role_color: result.roleColor }),
      ...(result.roleLevel === undefined ? {} : { role_level: result.roleLevel }),
    })),
  });
}

export function presentAdminStatus(value: RuntimeHealthSnapshot) {
  return adminStatusSchema.parse({
    db: value.database,
    r2: value.blob,
    ws: value.realtime,
    crons: value.scheduler,
  });
}
