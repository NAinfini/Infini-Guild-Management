import type { Event, WarHistory } from "@guild/shared";
import { apiRequest } from "../client";

export type DashboardSummaryParticipant = {
  user_id: string;
  username: string;
  role: string;
  classes: string[];
  power: number;
};

export type DashboardSummaryEvent = Event & {
  participants: DashboardSummaryParticipant[];
};

export type DashboardSummaryWarMvp = {
  category: string;
  label: string;
  name: string;
  initials: string;
  value: number;
};

export type DashboardSummaryResponse = {
  active_member_count: number;
  total_member_count: number;
  active_events_count: number;
  all_war_win_rate: number;
  upcoming_events: DashboardSummaryEvent[];
  my_signup_event_ids: string[];
  recent_wars: WarHistory[];
  recent_war_mvps: Array<DashboardSummaryWarMvp[] | null>;
};

export function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
  return apiRequest<DashboardSummaryResponse>("/api/dashboard/summary");
}
