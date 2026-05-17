import { create } from "zustand";
import { activeGame } from "@guild/shared/games";

type AnalyticsMode = "player" | "rankings" | "teams" | "radar";
type AnalyticsMetricKey = string;
type AnalyticsAggregation = "total" | "average" | "best" | "median";
export type AnalyticsDatePreset = "5" | "10" | "20" | "all";
export type HistoryViewMode = "table" | "chart";
type TeamAggregation = "total" | "average";
type ModifierWeights = Record<string, number>;

const DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS: ModifierWeights = { ...activeGame.war.modifierWeights };

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
  analyticsShowDeviation: boolean;
  analyticsShowContribution: boolean;
  analyticsHeatmapEnabled: boolean;
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
  setAnalyticsShowDeviation: (analyticsShowDeviation: boolean) => void;
  setAnalyticsShowContribution: (analyticsShowContribution: boolean) => void;
  setAnalyticsHeatmapEnabled: (analyticsHeatmapEnabled: boolean) => void;
  setModifierWeights: (modifierWeights: ModifierWeights) => void;
  setModifierWeightsInitialized: (modifierWeightsInitialized: boolean) => void;
  setHistoryViewMode: (historyViewMode: HistoryViewMode) => void;
  setHistoryChartMetric: (historyChartMetric: AnalyticsMetricKey) => void;
  setHistoryDateFrom: (historyDateFrom: string) => void;
  setHistoryDateTo: (historyDateTo: string) => void;
  setHistoryPage: (historyPage: number) => void;
  setHistoryPerPage: (historyPerPage: number) => void;
};

const defaultMetric = activeGame.war.memberStats[3]?.key ?? "damage";

export const useGuildWarStore = create<GuildWarStoreState>((set) => ({
  selectedEventId: undefined,
  selectedHistoryId: null,
  analyticsMode: "player",
  analyticsSelectedMetrics: [defaultMetric],
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
  analyticsShowDeviation: false,
  analyticsShowContribution: false,
  analyticsHeatmapEnabled: false,
  modifierWeights: DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS,
  modifierWeightsInitialized: false,
  historyViewMode: "table",
  historyChartMetric: defaultMetric,
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
  setAnalyticsShowDeviation: (analyticsShowDeviation) => set({ analyticsShowDeviation }),
  setAnalyticsShowContribution: (analyticsShowContribution) => set({ analyticsShowContribution }),
  setAnalyticsHeatmapEnabled: (analyticsHeatmapEnabled) => set({ analyticsHeatmapEnabled }),
  setModifierWeights: (modifierWeights) => set({ modifierWeights }),
  setModifierWeightsInitialized: (modifierWeightsInitialized) => set({ modifierWeightsInitialized }),
  setHistoryViewMode: (historyViewMode) => set({ historyViewMode }),
  setHistoryChartMetric: (historyChartMetric) => set({ historyChartMetric }),
  setHistoryDateFrom: (historyDateFrom) => set({ historyDateFrom, historyPage: 1 }),
  setHistoryDateTo: (historyDateTo) => set({ historyDateTo, historyPage: 1 }),
  setHistoryPage: (historyPage) => set({ historyPage }),
  setHistoryPerPage: (historyPerPage) => set({ historyPerPage, historyPage: 1 }),
}));
