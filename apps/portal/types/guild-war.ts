import type { GuildWarMemberResponse } from "@guild/shared";

export type AnalyticsMode = "player" | "rankings" | "teams" | "radar" | "wars";
export type AnalyticsMetricKey = string;
export type AnalyticsAggregation = "total" | "average" | "best" | "median";
export type AnalyticsDatePreset = "5" | "10" | "20" | "all";
export type TeamAggregation = "total" | "average";
export type HistoryViewMode = "table" | "chart";

export type AnalyticsTableColumn = {
  title: string;
  key: string;
  dataIndex?: string;
};

export type HistoryMemberStatsUpdate = {
  userId: string;
  payload: Partial<Record<string, number>>;
};

export type HistorySummaryRow = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  created_at: string;
  own_stats: Record<string, number | null> | null;
  enemy_stats: Record<string, number | null> | null;
};

export type HistoryMemberStat = Pick<
  GuildWarMemberResponse,
  "id" | "user_id" | "username" | "role_tag" | "stats"
>;

export type HistoryDetailTeam = {
  id: string;
  team_name: string;
  notes: string | null;
  members: Array<Pick<
    GuildWarMemberResponse,
    "user_id" | "username" | "avatar_media_id" | "role_tag"
  >>;
};

export type HistoryDetailData = {
  id: string;
  war_name: string;
  enemy_name: string | null;
  result: string | null;
  own_stats: Record<string, number | null> | null;
  enemy_stats: Record<string, number | null> | null;
  notes: string | null;
  member_stats: HistoryMemberStat[];
  teams: HistoryDetailTeam[];
};

export type HistoryMvpSummary = Array<{
  key: string;
  label: string;
  value: string;
}>;
