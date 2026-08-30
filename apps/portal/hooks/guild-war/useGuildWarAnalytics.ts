import { useEffect, useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ANALYTICS_SELECTION_SOFT_CAP,
  GuildWarService,
  fetchGuildWarAnalytics,
  fetchGuildWarHistoryBatch,
} from "../../services/GuildWarService";
import { fetchAbsencesWindow } from "../../services/UserService";
import { queryKeys } from "../../api/query-keys";
import { useShallow } from "zustand/react/shallow";
import { useGuildWarStore } from "../../stores/guildWar";
import { useAuthStore } from "../../stores/auth";
import type { AnalyticsDatePreset } from "../../types/guild-war";
import { copyPlainText } from "../../utils/copy";
import { localDateKey } from "../../utils/datetime";
import { useGuildWarAnalyticsComputed } from "./useGuildWarAnalyticsComputed";
import { notifySuccess, notifyWarning } from "../../utils/notifications";
import { updateAdminAnalyticsSettings } from "../../services/SiteConfigService";
import { useAppError } from "../useAppError";
import {
  getMetricLabelKey,
  hashToPaletteColor,
  metricValueFromWarMember,
  metricValueOrNullFromWarMember,
  normalizeMetricValue,
} from "../../utils/guild-war-analytics";
import { DEFAULT_GAME_RULES, formatCsvCell, GUILD_WAR_KDA_KEY } from "@guild/shared";

type UseGuildWarAnalyticsParams = {
  historyRows: Array<{ id: string; war_name: string; created_at: string }>;
  chartPalette: string[];
  guildWarService: GuildWarService;
};

export function buildAnalyticsCsv(
  columns: readonly Readonly<{ dataKey: string; title: string }>[],
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  return [
    columns.map(({ title }) => formatCsvCell(title, { alwaysQuote: true })).join(","),
    ...rows.map((row) => columns
      .map(({ dataKey }) => formatCsvCell(row[dataKey], { alwaysQuote: true }))
      .join(",")),
  ].join("\n");
}

export function useGuildWarAnalytics({
  historyRows,
  chartPalette,
  guildWarService,
}: UseGuildWarAnalyticsParams) {
  const { t } = useTranslation("guild-war");
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const hasSession = useAuthStore((state) => Boolean(state.user));
  const warRules = DEFAULT_GAME_RULES.guild_war;
  const {
    analyticsMode,
    setAnalyticsMode,
    analyticsSelectedMetrics,
    setAnalyticsSelectedMetrics,
    analyticsOnlyParticipated,
    setAnalyticsOnlyParticipated,
    analyticsDatePreset,
    setAnalyticsDatePreset,
    analyticsSelectedWarIds,
    setAnalyticsSelectedWarIds,
    analyticsSelectedUsers,
    setAnalyticsSelectedUsers,
    analyticsWarStat,
    setAnalyticsWarStat,
    analyticsAggregation,
    setAnalyticsAggregation,
    analyticsMinParticipation,
    setAnalyticsMinParticipation,
    analyticsTopN,
    setAnalyticsTopN,
    analyticsSelectedTeams,
    setAnalyticsSelectedTeams,
    analyticsTeamAggregation,
    setAnalyticsTeamAggregation,
    analyticsNormEnabled,
    setAnalyticsNormEnabled,
    analyticsShowDeviation,
    setAnalyticsShowDeviation,
    analyticsShowContribution,
    setAnalyticsShowContribution,
    analyticsHeatmapEnabled,
    setAnalyticsHeatmapEnabled,
    modifierWeights,
    setModifierWeights,
    modifierWeightsInitialized,
    setModifierWeightsInitialized,
  } = useGuildWarStore(
    useShallow((s) => ({
      analyticsMode: s.analyticsMode,
      setAnalyticsMode: s.setAnalyticsMode,
      analyticsSelectedMetrics: s.analyticsSelectedMetrics,
      setAnalyticsSelectedMetrics: s.setAnalyticsSelectedMetrics,
      analyticsOnlyParticipated: s.analyticsOnlyParticipated,
      setAnalyticsOnlyParticipated: s.setAnalyticsOnlyParticipated,
      analyticsDatePreset: s.analyticsDatePreset,
      setAnalyticsDatePreset: s.setAnalyticsDatePreset,
      analyticsSelectedWarIds: s.analyticsSelectedWarIds,
      setAnalyticsSelectedWarIds: s.setAnalyticsSelectedWarIds,
      analyticsSelectedUsers: s.analyticsSelectedUsers,
      setAnalyticsSelectedUsers: s.setAnalyticsSelectedUsers,
      analyticsWarStat: s.analyticsWarStat,
      setAnalyticsWarStat: s.setAnalyticsWarStat,
      analyticsAggregation: s.analyticsAggregation,
      setAnalyticsAggregation: s.setAnalyticsAggregation,
      analyticsMinParticipation: s.analyticsMinParticipation,
      setAnalyticsMinParticipation: s.setAnalyticsMinParticipation,
      analyticsTopN: s.analyticsTopN,
      setAnalyticsTopN: s.setAnalyticsTopN,
      analyticsSelectedTeams: s.analyticsSelectedTeams,
      setAnalyticsSelectedTeams: s.setAnalyticsSelectedTeams,
      analyticsTeamAggregation: s.analyticsTeamAggregation,
      setAnalyticsTeamAggregation: s.setAnalyticsTeamAggregation,
      analyticsNormEnabled: s.analyticsNormEnabled,
      setAnalyticsNormEnabled: s.setAnalyticsNormEnabled,
      analyticsShowDeviation: s.analyticsShowDeviation,
      setAnalyticsShowDeviation: s.setAnalyticsShowDeviation,
      analyticsShowContribution: s.analyticsShowContribution,
      setAnalyticsShowContribution: s.setAnalyticsShowContribution,
      analyticsHeatmapEnabled: s.analyticsHeatmapEnabled,
      setAnalyticsHeatmapEnabled: s.setAnalyticsHeatmapEnabled,
      modifierWeights: s.modifierWeights,
      setModifierWeights: s.setModifierWeights,
      modifierWeightsInitialized: s.modifierWeightsInitialized,
      setModifierWeightsInitialized: s.setModifierWeightsInitialized,
    })),
  );

  const analyticsWarIds = useMemo(() => {
    if (historyRows.length === 0) {
      return [] as string[];
    }
    if (analyticsSelectedWarIds.length > 0) {
      return analyticsSelectedWarIds;
    }
    if (analyticsDatePreset === "all") {
      return historyRows.map((row) => row.id);
    }
    const count = Number.parseInt(analyticsDatePreset, 10);
    if (!Number.isFinite(count) || count <= 0) {
      return historyRows.map((row) => row.id);
    }
    return historyRows.slice(0, count).map((row) => row.id);
  }, [analyticsDatePreset, analyticsSelectedWarIds, historyRows]);

  const analyticsQuery = useQuery({
    queryKey: queryKeys.guildWar.analytics(analyticsWarIds.join(",")),
    queryFn: () =>
      fetchGuildWarAnalytics({
        war_ids: analyticsWarIds,
      }),
    enabled: analyticsWarIds.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });

  const analyticsDetailsQuery = useQuery({
    queryKey: queryKeys.guildWar.analyticsDetails(analyticsWarIds.join(",")),
    queryFn: async () => {
      const res = await fetchGuildWarHistoryBatch(analyticsWarIds);
      return res.data;
    },
    enabled: analyticsWarIds.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });

  const analyticsRows = analyticsQuery.data?.member_stats ?? [];
  const analyticsWarDetails = analyticsDetailsQuery.data ?? [];

  /* 一次窗口覆盖出勤分析选中的全部战役。按阅读者本地日期取——请假是日历日期，
     窗口要和界面上显示的战役日期对得上，否则边界那天的请假会查不出来。 */
  const absencesWindow = useMemo(() => {
    if (analyticsWarDetails.length === 0) {
      return null;
    }
    let from = localDateKey(analyticsWarDetails[0]!.created_at);
    let to = from;
    for (const war of analyticsWarDetails) {
      const date = localDateKey(war.created_at);
      if (date < from) from = date;
      if (date > to) to = date;
    }
    return { from, to };
  }, [analyticsWarDetails]);

  const absencesQuery = useQuery({
    queryKey: queryKeys.absences.window(absencesWindow?.from ?? "", absencesWindow?.to ?? ""),
    queryFn: () => fetchAbsencesWindow(absencesWindow!.from, absencesWindow!.to),
    enabled: hasSession && Boolean(absencesWindow),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const analyticsAbsences = useMemo(() => absencesQuery.data?.data ?? [], [absencesQuery.data]);

  const analyticsWarOptions = useMemo(
    () =>
      historyRows.map((row) => ({
        value: row.id,
        label: `${row.war_name} (${localDateKey(row.created_at)})`,
      })),
    [historyRows],
  );

  const analyticsSettings = analyticsQuery.data?.analytics_settings;
  const referenceDuration = analyticsSettings?.reference_duration_minutes ?? 30;

  useEffect(() => {
    const metricKeys = new Set([
      ...warRules.member_stats.map((definition) => definition.key),
      GUILD_WAR_KDA_KEY,
    ]);
    const validMetrics = analyticsSelectedMetrics.filter((metric) => metricKeys.has(metric));
    if (validMetrics.length !== analyticsSelectedMetrics.length || validMetrics.length === 0) {
      setAnalyticsSelectedMetrics(validMetrics.length > 0 ? validMetrics : [warRules.default_member_stat_key]);
    }
    if (!warRules.team_stats.some((definition) => definition.key === analyticsWarStat)) {
      const fallback = warRules.team_stats.find((definition) => definition.dashboard === "primary")
        ?? warRules.team_stats[0];
      if (fallback) setAnalyticsWarStat(fallback.key);
    }
  }, [analyticsSelectedMetrics, analyticsWarStat, setAnalyticsSelectedMetrics, setAnalyticsWarStat, warRules]);

  useEffect(() => {
    if (analyticsSettings && !modifierWeightsInitialized) {
      setModifierWeights({ ...analyticsSettings.modifier_weights });
      setModifierWeightsInitialized(true);
    }
  }, [analyticsSettings, modifierWeightsInitialized]);

  const modifierWeightsDirty = analyticsSettings
    ? Object.entries(modifierWeights).some(
      ([key, weight]) => analyticsSettings.modifier_weights[
        key as keyof typeof analyticsSettings.modifier_weights
      ] !== weight,
    )
    : false;
  const modifierWeightsValid = Object.values(modifierWeights).some((weight) => weight > 0);
  const saveModifierWeightsMutation = useMutation({
    mutationFn: () => updateAdminAnalyticsSettings({ modifier_weights: modifierWeights }),
    onSuccess: async (settings) => {
      setModifierWeights({ ...settings.modifier_weights });
      setModifierWeightsInitialized(true);
      notifySuccess(t("analytics.normalization.saved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.guildWar.analyticsAll() });
    },
    onError: (error) => {
      showError(error, t("analytics.normalization.saveFailed"));
    },
  });

  const warNormContext = useMemo(() => {
    const wars = analyticsQuery.data?.wars ?? [];
    const map = new Map<string, { durationMinutes: number | null; modifier: number }>();
    for (const war of wars) {
      map.set(war.id, {
        durationMinutes: war.duration_minutes,
        modifier: war.modifier,
      });
    }
    return map;
  }, [analyticsQuery.data?.wars]);

  const computed = useGuildWarAnalyticsComputed({
    analyticsMode,
    analyticsSelectedMetrics,
    analyticsAggregation,
    analyticsMinParticipation,
    analyticsTopN,
    analyticsSelectedTeams,
    analyticsTeamAggregation,
    analyticsSelectedUsers,
    analyticsOnlyParticipated,
    analyticsNormEnabled,
    analyticsShowDeviation,
    analyticsShowContribution,
    analyticsWarDetails,
    analyticsWars: analyticsQuery.data?.wars ?? [],
    analyticsWarStat,
    analyticsRows,
    analyticsAbsences,
    warNormContext,
    referenceDuration,
    chartPalette,
    getMetricLabelKey,
    metricValueFromWarMember,
    metricValueOrNullFromWarMember,
    normalizeMetricValue,
  });

  useEffect(() => {
    if (analyticsSelectedWarIds.length > 0) {
      setAnalyticsDatePreset("all");
    }
  }, [analyticsSelectedWarIds]);

  const applyAnalyticsSelection = (nextSelection: string[]) => {
    const result = guildWarService.applyAnalyticsSelection(nextSelection);
    if (result.warning?.type === "capped") {
      notifyWarning(t("analytics.selectionCapped", { cap: result.warning.cap }));
    } else if (result.warning?.type === "large") {
      notifyWarning(t("analytics.largeCompareWarning", { count: result.warning.count }));
    }
    setAnalyticsSelectedUsers(result.selection);
  };

  const copyAnalyticsCsv = async () => {
    const columns = computed.analyticsTableColumns.flatMap((column) => {
      const dataKey = column.dataIndex ?? column.key;
      return dataKey ? [{ dataKey, title: column.title }] : [];
    });
    await copyPlainText(buildAnalyticsCsv(
      columns,
      computed.analyticsTableRows as Array<Record<string, unknown>>,
    ));
    notifySuccess(t("message.csvCopied"));
  };

  const handleAnalyticsDatePresetChange = (value: AnalyticsDatePreset) => {
    setAnalyticsDatePreset(value);
    if (value !== "all") {
      setAnalyticsSelectedWarIds([]);
    }
  };

  return {
    analyticsQuery,
    analyticsDetailsQuery,
    analyticsWarIds,
    analyticsMode,
    setAnalyticsMode,
    analyticsSelectedMetrics,
    setAnalyticsSelectedMetrics,
    analyticsOnlyParticipated,
    setAnalyticsOnlyParticipated,
    analyticsDatePreset,
    analyticsSelectedWarIds,
    setAnalyticsSelectedWarIds,
    analyticsSelectedUsers,
    analyticsWarStat,
    setAnalyticsWarStat,
    analyticsAggregation,
    setAnalyticsAggregation,
    analyticsMinParticipation,
    setAnalyticsMinParticipation,
    analyticsTopN,
    setAnalyticsTopN,
    analyticsSelectedTeams,
    setAnalyticsSelectedTeams,
    analyticsTeamAggregation,
    setAnalyticsTeamAggregation,
    analyticsNormEnabled,
    setAnalyticsNormEnabled,
    analyticsShowDeviation,
    setAnalyticsShowDeviation,
    analyticsShowContribution,
    setAnalyticsShowContribution,
    analyticsHeatmapEnabled,
    setAnalyticsHeatmapEnabled,
    modifierWeights,
    setModifierWeights,
    modifierWeightsDirty,
    modifierWeightsValid,
    saveModifierWeights: () => {
      if (modifierWeightsDirty && modifierWeightsValid && !saveModifierWeightsMutation.isPending) {
        saveModifierWeightsMutation.mutate();
      }
    },
    saveModifierWeightsPending: saveModifierWeightsMutation.isPending,
    referenceDuration,
    analyticsWarOptions,
    analyticsSelectableUserIds: computed.analyticsSelectableUserIds,
    analyticsUserIdToUsername: computed.analyticsUserIdToUsername,
    analyticsUserIdToAvatarMediaId: computed.analyticsUserIdToAvatarMediaId,
    analyticsTeamOptions: computed.analyticsTeamOptions,
    analyticsMetricLabel: computed.analyticsMetricLabel,
    analyticsWarSummary: computed.analyticsWarSummary,
    analyticsChartOption: computed.analyticsChartOption,
    analyticsRadarOption: computed.analyticsRadarOption,
    analyticsTableRows: computed.analyticsTableRows,
    analyticsTableColumns: computed.analyticsTableColumns,
    analyticsTableHeatmapRanges: computed.analyticsTableHeatmapRanges,
    applyAnalyticsSelection,
    copyAnalyticsCsv,
    handleAnalyticsDatePresetChange,
    getNormalizedMetricValue: computed.getNormalizedMetricValue,
    getNormalizedMetricValueOrNull: computed.getNormalizedMetricValueOrNull,
    metricValueFromWarMember,
    metricValueOrNullFromWarMember,
    getMetricLabelKey,
    hashToPaletteColor,
    selectionSoftCap: ANALYTICS_SELECTION_SOFT_CAP,
  };
}

export type GuildWarAnalyticsController = ReturnType<typeof useGuildWarAnalytics>;

export {
  getMetricLabelKey,
  hashToPaletteColor,
  metricValueFromWarMember,
  metricValueOrNullFromWarMember,
  normalizeMetricValue,
};

export type { AnalyticsMetricKey, AnalyticsAggregation, AnalyticsTableColumn } from "../../types/guild-war";
