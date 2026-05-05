import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { activeGame } from "@guild/shared/games";
import {
  ANALYTICS_SELECTION_SOFT_CAP,
  GuildWarService,
  fetchGuildWarAnalytics,
  fetchGuildWarHistoryBatch,
} from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";
import { useGuildWarStore, type AnalyticsDatePreset } from "../../stores/guildWar";
import { copyPlainText } from "../../utils/copy";
import { useGuildWarAnalyticsComputed } from "./useGuildWarAnalyticsComputed";
import { notifySuccess, notifyWarning } from "../../utils/notifications";

const message = {
  success: (content: string) => notifySuccess(content),
  warning: (content: string) => notifyWarning(content),
};

type AnalyticsMetricKey = string;
type AnalyticsAggregation = "total" | "average" | "best" | "median";

type AnalyticsTableColumn = {
  title: string;
  key: string;
  dataIndex?: string;
};

const METRIC_LABEL_MAP: Record<string, string> = Object.fromEntries(
  activeGame.war.memberStats.map((s) => [s.key, s.label.replace(/^guild-war:/, "")]),
);

export function getMetricLabelKey(metric: AnalyticsMetricKey): string {
  if (metric === "kda") return "analytics.metric.kda";
  return METRIC_LABEL_MAP[metric] ?? metric;
}

export function metricValueFromWarMember(
  row: {
    stats: Record<string, number | null> | null;
  },
  metric: AnalyticsMetricKey,
): number {
  const s = row.stats ?? {};
  const computedDef = activeGame.war.computedStats?.find((c) => c.key === metric);
  if (computedDef) {
    const resolved: Record<string, number> = {};
    for (const stat of activeGame.war.memberStats) {
      resolved[stat.key] = s[stat.key] ?? 0;
    }
    return computedDef.compute(resolved);
  }
  return s[metric] ?? 0;
}

export function metricValueOrNullFromWarMember(
  row: {
    stats: Record<string, number | null> | null;
  },
  metric: AnalyticsMetricKey,
): number | null {
  const computedDef = activeGame.war.computedStats?.find((c) => c.key === metric);
  if (computedDef) {
    const s = row.stats ?? {};
    const hasAny = activeGame.war.memberStats.some((stat) => s[stat.key] !== null && s[stat.key] !== undefined);
    if (!hasAny) return null;
    return metricValueFromWarMember(row, metric);
  }
  const value = row.stats?.[metric];
  return value === null || value === undefined ? null : value;
}

const LOWER_IS_BETTER_METRICS: Set<string> = new Set(
  [
    ...activeGame.war.memberStats.filter((s) => s.lowerIsBetter).map((s) => s.key),
    ...(activeGame.war.computedStats?.filter((s) => s.lowerIsBetter).map((s) => s.key) ?? []),
  ],
);

export function normalizeMetricValue(
  rawValue: number,
  metric: AnalyticsMetricKey,
  durationMinutes: number | null,
  referenceDuration: number,
  modifier: number,
): number {
  let timeNormalized = rawValue;
  if (durationMinutes !== null && durationMinutes > 0) {
    timeNormalized = (rawValue / durationMinutes) * referenceDuration;
  }
  if (modifier !== 1 && modifier > 0) {
    if (LOWER_IS_BETTER_METRICS.has(metric)) {
      timeNormalized = timeNormalized / modifier;
    } else {
      timeNormalized = timeNormalized * modifier;
    }
  }
  return Number(timeNormalized.toFixed(2));
}

export function hashToPaletteColor(value: string, palette: string[]): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length] ?? "var(--ant-color-primary)";
}

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
    analyticsFocusedUser,
    setAnalyticsFocusedUser,
    analyticsSelectedUsers,
    setAnalyticsSelectedUsers,
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
  } = useGuildWarStore();

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
    enabled: analyticsWarIds.length > 0 && (analyticsMode !== "player" || Boolean(analyticsFocusedUser)),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });

  const analyticsRows = analyticsQuery.data?.member_stats ?? [];
  const analyticsWarDetails = analyticsDetailsQuery.data ?? [];
  const analyticsWarsCount = analyticsWarIds.length;

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
    analyticsNormEnabled,
    analyticsShowDeviation,
    analyticsShowContribution,
    analyticsWarDetails,
    analyticsRows,
    warNormContext,
    referenceDuration,
    chartPalette,
    getMetricLabelKey,
    metricValueFromWarMember,
    metricValueOrNullFromWarMember,
    normalizeMetricValue,
  });

  useEffect(() => {
    if (!analyticsFocusedUser && computed.analyticsSelectableUserIds.length > 0) {
      setAnalyticsFocusedUser(computed.analyticsSelectableUserIds[0] ?? "");
    }
  }, [analyticsFocusedUser, computed.analyticsSelectableUserIds]);

  useEffect(() => {
    if (analyticsSelectedWarIds.length > 0) {
      setAnalyticsDatePreset("all");
    }
  }, [analyticsSelectedWarIds]);

  const analyticsFocusLabel = useMemo(() => {
    if (analyticsMode === "player") {
      return analyticsFocusedUser || "none";
    }
    return computed.analyticsFocusLabel;
  }, [analyticsFocusedUser, analyticsMode, computed.analyticsFocusLabel]);

  const applyAnalyticsSelection = (nextSelection: string[]) => {
    const result = guildWarService.applyAnalyticsSelection(nextSelection);
    if (result.warning?.type === "capped") {
      message.warning(t("analytics.selectionCapped", { cap: result.warning.cap }));
    } else if (result.warning?.type === "large") {
      message.warning(t("analytics.largeCompareWarning", { count: result.warning.count }));
    }
    setAnalyticsSelectedUsers(result.selection);
  };

  const copyAnalyticsSnapshot = async () => {
    const lines = [
      t("analytics.snapshotTitle"),
      `Mode: ${analyticsMode}`,
      `Metric: ${computed.analyticsMetricLabel}`,
      `Wars: ${analyticsWarsCount}`,
      `Focus: ${analyticsFocusLabel}`,
      ...computed.analyticsTableRows
        .slice(0, 5)
        .map((row, index) => `${index + 1}. ${JSON.stringify(row)}`),
    ];
    await copyPlainText(lines.join("\n"));
    message.success(t("message.snapshotCopied"));
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
    analyticsFocusedUser,
    setAnalyticsFocusedUser,
    analyticsSelectedUsers,
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
    analyticsChartOption: computed.analyticsChartOption,
    analyticsRadarOption: computed.analyticsRadarOption,
    analyticsTableRows: computed.analyticsTableRows,
    analyticsTableColumns: computed.analyticsTableColumns,
    analyticsTableHeatmapRanges: computed.analyticsTableHeatmapRanges,
    analyticsFocusLabel,
    applyAnalyticsSelection,
    copyAnalyticsSnapshot,
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

export type { AnalyticsMetricKey, AnalyticsAggregation, AnalyticsTableColumn };
