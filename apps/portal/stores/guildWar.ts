import { create } from "zustand";

type AnalyticsMode = "player" | "rankings" | "teams";
type AnalyticsMetricKey =
  | "kills"
  | "deaths"
  | "assists"
  | "damage"
  | "healing"
  | "building_damage"
  | "credits"
  | "damage_taken"
  | "kda";
type AnalyticsAggregation = "total" | "average" | "best" | "median";
export type AnalyticsDatePreset = "5" | "10" | "20" | "all";
type HistoryViewMode = "table" | "chart";
type TeamAggregation = "total" | "average";
type ModifierWeights = {
  kda: number;
  towers: number;
  credits: number;
  distance: number;
  basehp: number;
};

const DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS: ModifierWeights = {
  kda: 0.30,
  towers: 0.10,
  credits: 0.30,
  distance: 0.15,
  basehp: 0.15,
};

type GuildWarStoreState = {
  selectedEventId: string | undefined;
  selectedHistoryId: string | null;
  analyticsMode: AnalyticsMode;
  analyticsSelectedMetrics: AnalyticsMetricKey[];
  analyticsOnlyParticipated: boolean;
  analyticsDatePreset: AnalyticsDatePreset;
  analyticsSelectedWarIds: string[];
  analyticsFocusedUser: string;
  analyticsSelectedUsers: string[];
  analyticsAggregation: AnalyticsAggregation;
  analyticsMinParticipation: number;
  analyticsTopN: number;
  analyticsSelectedTeams: string[];
  analyticsTeamAggregation: TeamAggregation;
  analyticsNormEnabled: boolean;
  modifierWeights: ModifierWeights;
  modifierWeightsInitialized: boolean;
  historyViewMode: HistoryViewMode;
  historyChartMetric: AnalyticsMetricKey;
  historyDateFrom: string;
  historyDateTo: string;
  historyPage: number;
  historyPerPage: number;
  setSelectedEventId: (selectedEventId: string | undefined) => void;
  setSelectedHistoryId: (selectedHistoryId: string | null) => void;
  setAnalyticsMode: (analyticsMode: AnalyticsMode) => void;
  setAnalyticsSelectedMetrics: (analyticsSelectedMetrics: AnalyticsMetricKey[]) => void;
  setAnalyticsOnlyParticipated: (analyticsOnlyParticipated: boolean) => void;
  setAnalyticsDatePreset: (analyticsDatePreset: AnalyticsDatePreset) => void;
  setAnalyticsSelectedWarIds: (analyticsSelectedWarIds: string[]) => void;
  setAnalyticsFocusedUser: (analyticsFocusedUser: string) => void;
  setAnalyticsSelectedUsers: (analyticsSelectedUsers: string[]) => void;
  setAnalyticsAggregation: (analyticsAggregation: AnalyticsAggregation) => void;
  setAnalyticsMinParticipation: (analyticsMinParticipation: number) => void;
  setAnalyticsTopN: (analyticsTopN: number) => void;
  setAnalyticsSelectedTeams: (analyticsSelectedTeams: string[]) => void;
  setAnalyticsTeamAggregation: (analyticsTeamAggregation: TeamAggregation) => void;
  setAnalyticsNormEnabled: (analyticsNormEnabled: boolean) => void;
  setModifierWeights: (modifierWeights: ModifierWeights) => void;
  setModifierWeightsInitialized: (modifierWeightsInitialized: boolean) => void;
  setHistoryViewMode: (historyViewMode: HistoryViewMode) => void;
  setHistoryChartMetric: (historyChartMetric: AnalyticsMetricKey) => void;
  setHistoryDateFrom: (historyDateFrom: string) => void;
  setHistoryDateTo: (historyDateTo: string) => void;
  setHistoryPage: (historyPage: number) => void;
  setHistoryPerPage: (historyPerPage: number) => void;
};

export const useGuildWarStore = create<GuildWarStoreState>((set) => ({
  selectedEventId: undefined,
  selectedHistoryId: null,
  analyticsMode: "player",
  analyticsSelectedMetrics: ["damage"],
  analyticsOnlyParticipated: true,
  analyticsDatePreset: "10",
  analyticsSelectedWarIds: [],
  analyticsFocusedUser: "",
  analyticsSelectedUsers: [],
  analyticsAggregation: "total",
  analyticsMinParticipation: 1,
  analyticsTopN: 10,
  analyticsSelectedTeams: [],
  analyticsTeamAggregation: "total",
  analyticsNormEnabled: true,
  modifierWeights: DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS,
  modifierWeightsInitialized: false,
  historyViewMode: "table",
  historyChartMetric: "damage",
  historyDateFrom: "",
  historyDateTo: "",
  historyPage: 1,
  historyPerPage: 20,
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setSelectedHistoryId: (selectedHistoryId) => set({ selectedHistoryId }),
  setAnalyticsMode: (analyticsMode) => set({ analyticsMode }),
  setAnalyticsSelectedMetrics: (analyticsSelectedMetrics) => set({ analyticsSelectedMetrics }),
  setAnalyticsOnlyParticipated: (analyticsOnlyParticipated) => set({ analyticsOnlyParticipated }),
  setAnalyticsDatePreset: (analyticsDatePreset) => set({ analyticsDatePreset }),
  setAnalyticsSelectedWarIds: (analyticsSelectedWarIds) => set({ analyticsSelectedWarIds }),
  setAnalyticsFocusedUser: (analyticsFocusedUser) => set({ analyticsFocusedUser }),
  setAnalyticsSelectedUsers: (analyticsSelectedUsers) => set({ analyticsSelectedUsers }),
  setAnalyticsAggregation: (analyticsAggregation) => set({ analyticsAggregation }),
  setAnalyticsMinParticipation: (analyticsMinParticipation) => set({ analyticsMinParticipation }),
  setAnalyticsTopN: (analyticsTopN) => set({ analyticsTopN }),
  setAnalyticsSelectedTeams: (analyticsSelectedTeams) => set({ analyticsSelectedTeams }),
  setAnalyticsTeamAggregation: (analyticsTeamAggregation) => set({ analyticsTeamAggregation }),
  setAnalyticsNormEnabled: (analyticsNormEnabled) => set({ analyticsNormEnabled }),
  setModifierWeights: (modifierWeights) => set({ modifierWeights }),
  setModifierWeightsInitialized: (modifierWeightsInitialized) => set({ modifierWeightsInitialized }),
  setHistoryViewMode: (historyViewMode) => set({ historyViewMode }),
  setHistoryChartMetric: (historyChartMetric) => set({ historyChartMetric }),
  setHistoryDateFrom: (historyDateFrom) => set({ historyDateFrom, historyPage: 1 }),
  setHistoryDateTo: (historyDateTo) => set({ historyDateTo, historyPage: 1 }),
  setHistoryPage: (historyPage) => set({ historyPage }),
  setHistoryPerPage: (historyPerPage) => set({ historyPerPage, historyPage: 1 }),
}));
