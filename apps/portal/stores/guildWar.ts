import { create } from "zustand";

export type AnalyticsMode = "player" | "compare" | "rankings" | "teams";
export type AnalyticsMetricKey =
  | "kills"
  | "deaths"
  | "assists"
  | "damage"
  | "healing"
  | "building_damage"
  | "credits"
  | "damage_taken"
  | "kda";
export type AnalyticsAggregation = "total" | "average" | "best" | "median";
export type AnalyticsDatePreset = "5" | "10" | "20" | "all";
export type HistoryViewMode = "table" | "chart";
export type TeamAggregation = "total" | "average";
export type ModifierWeights = {
  kda: number;
  towers: number;
  credits: number;
  distance: number;
  basehp: number;
};

export const DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS: ModifierWeights = {
  kda: 0.30,
  towers: 0.10,
  credits: 0.30,
  distance: 0.15,
  basehp: 0.15,
};

type GuildWarStoreState = {
  selectedEventId: string | undefined;
  selectedHistoryId: string | null;
  selectedTemplateId: string;
  templateName: string;
  templateDescription: string;
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
  setSelectedEventId: (selectedEventId: string | undefined) => void;
  setSelectedHistoryId: (selectedHistoryId: string | null) => void;
  setSelectedTemplateId: (selectedTemplateId: string) => void;
  setTemplateName: (templateName: string) => void;
  setTemplateDescription: (templateDescription: string) => void;
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
};

export const useGuildWarStore = create<GuildWarStoreState>((set) => ({
  selectedEventId: undefined,
  selectedHistoryId: null,
  selectedTemplateId: "",
  templateName: "",
  templateDescription: "",
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
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setSelectedHistoryId: (selectedHistoryId) => set({ selectedHistoryId }),
  setSelectedTemplateId: (selectedTemplateId) => set({ selectedTemplateId }),
  setTemplateName: (templateName) => set({ templateName }),
  setTemplateDescription: (templateDescription) => set({ templateDescription }),
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
  setHistoryDateFrom: (historyDateFrom) => set({ historyDateFrom }),
  setHistoryDateTo: (historyDateTo) => set({ historyDateTo }),
}));
