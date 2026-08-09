import type { Event, WarHistory } from "@guild/shared";
import { apiRequest } from "../client";

export type DashboardParticipant = {
  user_id: string;
  username: string;
  role: string;
  classes: string[];
  power: number;
  avatar_media_id: string | null;
};

export type DashboardEvent = Event & {
  participants: DashboardParticipant[];
};

export type DashboardWarMvp = {
  category: string;
  label: string;
  name: string;
  initials: string;
  value: number;
};

export type DashboardMemberStatsResponse = {
  active_member_count: number;
  total_member_count: number;
};

export type DashboardEventsResponse = {
  active_events_count: number;
  featured_events: DashboardEvent[];
  upcoming_events: DashboardEvent[];
  my_signup_event_ids: string[];
};

export type DashboardWarsResponse = {
  all_war_win_rate: number;
  recent_wars: WarHistory[];
  recent_war_mvps: Array<DashboardWarMvp[] | null>;
};

export function fetchDashboardMemberStats(): Promise<DashboardMemberStatsResponse> {
  return apiRequest<DashboardMemberStatsResponse>("/api/dashboard/members");
}

export function fetchDashboardEvents(options?: { externalView?: boolean }): Promise<DashboardEventsResponse> {
  const suffix = options?.externalView ? "?external_view=true" : "";
  return apiRequest<DashboardEventsResponse>(`/api/dashboard/events${suffix}`);
}

export function fetchDashboardWars(): Promise<DashboardWarsResponse> {
  return apiRequest<DashboardWarsResponse>("/api/dashboard/wars");
}
