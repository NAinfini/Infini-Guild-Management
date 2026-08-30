import type { Event, ExternalDashboardWar } from "@guild/shared";
import { apiRequest } from "../client";

export type DashboardParticipant = {
  user_id: string;
  display_name: string;
  role: string;
  classes: string[];
  power: number;
  avatar_media_id: string | null;
};

export type DashboardQuotaSummary = {
  slots: Array<{
    tag_id: string;
    required: number;
    matched: number;
    dedicated: number;
    eligible: number;
    floor: number;
    ceiling: number;
    status: "filled" | "flex" | "short";
  }>;
  benched_count: number;
  unassigned_count: number;
  flexible: number;
  required_total: number;
  matched_total: number;
  shortfall: number;
};

export type DashboardEvent = Event & {
  participant_count: number;
  participant_preview: DashboardParticipant[];
  quota_summary: DashboardQuotaSummary | null;
};

export type DashboardWarMvp = {
  category: string;
  label: string;
  name: string;
  initials: string;
  value: number;
};

export type DashboardEventsResponse = {
  active_events_count: number;
  featured_events: DashboardEvent[];
  upcoming_events: DashboardEvent[];
  my_signup_event_ids: string[];
};

export type DashboardWarsResponse = {
  all_war_win_rate: number;
  recent_wars: ExternalDashboardWar[];
  recent_war_mvps?: Array<DashboardWarMvp[] | null>;
};

export function fetchDashboardEvents(options?: { externalView?: boolean }): Promise<DashboardEventsResponse> {
  const suffix = options?.externalView ? "?external_view=true" : "";
  return apiRequest<DashboardEventsResponse>(`/api/dashboard/events${suffix}`);
}

export function fetchDashboardWars(options?: { externalView?: boolean }): Promise<DashboardWarsResponse> {
  const suffix = options?.externalView ? "?external_view=true" : "";
  return apiRequest<DashboardWarsResponse>(`/api/dashboard/wars${suffix}`);
}
