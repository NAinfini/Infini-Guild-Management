import { create } from "zustand";
import { DEFAULT_GAME_RULES, DEFAULT_SITE_ANALYTICS_SETTINGS } from "@guild/shared";
import type { SiteAnalyticsSettings } from "@guild/shared";
import type {
  AnalyticsAggregation,
  AnalyticsDatePreset,
  AnalyticsMetricKey,
  AnalyticsMode,
  HistoryViewMode,
  TeamAggregation,
} from "../types/guild-war";

type ModifierWeights = SiteAnalyticsSettings["modifier_weights"];

export type { AnalyticsDatePreset, HistoryViewMode } from "../types/guild-war";

const DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS: ModifierWeights = {
  ...DEFAULT_SITE_ANALYTICS_SETTINGS.modifier_weights,
};

type GuildWarStoreState = {
  selectedEventId: string | undefined;
  selectedHistoryId: string | null;
  analyticsMode: AnalyticsMode;
  analyticsSelectedMetrics: AnalyticsMetricKey[];
  analyticsOnlyParticipated: boolean;
  analyticsDatePreset: AnalyticsDatePreset;
  analyticsSelectedWarIds: string[];
  analyticsSelectedUsers: string[];
  analyticsWarStat: string;
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
  setAnalyticsSelectedUsers: (analyticsSelectedUsers: string[]) => void;
  setAnalyticsWarStat: (analyticsWarStat: string) => void;
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
  resetSessionState: () => void;
};

const defaultMetric = DEFAULT_GAME_RULES.guild_war.default_member_stat_key;
const defaultTeamStat = DEFAULT_GAME_RULES.guild_war.team_stats.find((definition) => definition.dashboard === "primary")?.key
  ?? DEFAULT_GAME_RULES.guild_war.team_stats[0]!.key;

export const useGuildWarStore = create<GuildWarStoreState>((set) => ({
  selectedEventId: undefined,
  selectedHistoryId: null,
  analyticsMode: "player",
  analyticsSelectedMetrics: [defaultMetric],
  analyticsOnlyParticipated: true,
  analyticsDatePreset: "10",
  analyticsSelectedWarIds: [],
  analyticsSelectedUsers: [],
  analyticsWarStat: defaultTeamStat,
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
  setAnalyticsSelectedUsers: (analyticsSelectedUsers) => set({ analyticsSelectedUsers }),
  setAnalyticsWarStat: (analyticsWarStat) => set({ analyticsWarStat }),
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
  resetSessionState: () => set({
    selectedEventId: undefined,
    selectedHistoryId: null,
    analyticsMode: "player",
    analyticsSelectedMetrics: [defaultMetric],
    analyticsOnlyParticipated: true,
    analyticsDatePreset: "10",
    analyticsSelectedWarIds: [],
    analyticsSelectedUsers: [],
    analyticsWarStat: defaultTeamStat,
    analyticsAggregation: "total",
    analyticsMinParticipation: 1,
    analyticsTopN: 10,
    analyticsSelectedTeams: [],
    analyticsTeamAggregation: "total",
    analyticsNormEnabled: true,
    analyticsShowDeviation: false,
    analyticsShowContribution: false,
    analyticsHeatmapEnabled: false,
    modifierWeights: { ...DEFAULT_GUILD_WAR_MODIFIER_WEIGHTS },
    modifierWeightsInitialized: false,
    historyViewMode: "table",
    historyChartMetric: defaultMetric,
    historyDateFrom: "",
    historyDateTo: "",
    historyPage: 1,
    historyPerPage: 20,
  }),
}));
