import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { useGuildWarStore, type AnalyticsDatePreset } from "../../stores/guildWar";
import { copyPlainText } from "../../utils/copy";
import { useGuildWarAnalyticsComputed } from "./useGuildWarAnalyticsComputed";
import { notifySuccess, notifyWarning } from "../../utils/notifications";
import {
  getMetricLabelKey,
  hashToPaletteColor,
  metricValueFromWarMember,
  metricValueOrNullFromWarMember,
  normalizeMetricValue,
  type AnalyticsAggregation,
  type AnalyticsMetricKey,
} from "../../utils/guild-war-analytics";

const message = {
  success: (content: string) => notifySuccess(content),
  warning: (content: string) => notifyWarning(content),
};

type AnalyticsTableColumn = {
  title: string;
  key: string;
  dataIndex?: string;
};

type UseGuildWarAnalyticsParams = {
  historyRows: Array<{ id: string; war_name: string; created_at: string }>;
  chartPalette: string[];
  guildWarService: GuildWarService;
};

export function useGuildWarAnalytics({
  historyRows,
  chartPalette,
  guildWarService,
}: UseGuildWarAnalyticsParams) {
  const { t } = useTranslation("guild-war");
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

  // Absence (请假) window covering all selected wars — used to excuse
  // rostered-but-absent members from the attendance denominator.
  const absencesWindow = useMemo(() => {
    if (analyticsWarDetails.length === 0) {
      return null;
    }
    let from = analyticsWarDetails[0]!.created_at.slice(0, 10);
    let to = from;
    for (const war of analyticsWarDetails) {
      const date = war.created_at.slice(0, 10);
      if (date < from) from = date;
      if (date > to) to = date;
    }
    return { from, to };
  }, [analyticsWarDetails]);

  const absencesQuery = useQuery({
    queryKey: queryKeys.absences.window(absencesWindow?.from ?? "", absencesWindow?.to ?? ""),
    queryFn: () => fetchAbsencesWindow(absencesWindow!.from, absencesWindow!.to),
    enabled: Boolean(absencesWindow),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const analyticsAbsences = useMemo(() => absencesQuery.data?.data ?? [], [absencesQuery.data]);

  const analyticsWarOptions = useMemo(
    () =>
      historyRows.map((row) => ({
        value: row.id,
        label: `${row.war_name} (${row.created_at.slice(0, 10)})`,
      })),
    [historyRows],
  );

  const analyticsSettings = analyticsQuery.data?.analytics_settings;
  const referenceDuration = analyticsSettings?.reference_duration_minutes ?? 30;

  useEffect(() => {
    if (analyticsSettings && !modifierWeightsInitialized) {
      setModifierWeights({ ...analyticsSettings.modifier_weights });
      setModifierWeightsInitialized(true);
    }
  }, [analyticsSettings, modifierWeightsInitialized]);

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
      message.warning(t("analytics.selectionCapped", { cap: result.warning.cap }));
    } else if (result.warning?.type === "large") {
      message.warning(t("analytics.largeCompareWarning", { count: result.warning.count }));
    }
    setAnalyticsSelectedUsers(result.selection);
  };

  const copyAnalyticsCsv = async () => {
    const headers = computed.analyticsTableColumns
      .map((column) => ("dataIndex" in column ? String(column.dataIndex) : column.key))
      .filter((value): value is string => Boolean(value));
    const lines = [headers.join(",")];
    for (const row of computed.analyticsTableRows as Array<Record<string, unknown>>) {
      lines.push(
        headers
          .map((header) => {
            const value = row[header];
            const text = value === null || value === undefined ? "" : String(value);
            return `"${text.replaceAll("\"", "\"\"")}"`;
          })
          .join(","),
      );
    }
    await copyPlainText(lines.join("\n"));
    message.success(t("message.csvCopied"));
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
    referenceDuration,
    analyticsWarOptions,
    analyticsSelectableUserIds: computed.analyticsSelectableUserIds,
    analyticsUserIdToUsername: computed.analyticsUserIdToUsername,
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

export type { AnalyticsMetricKey, AnalyticsAggregation, AnalyticsTableColumn };
