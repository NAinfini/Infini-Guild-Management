import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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

type AnalyticsTableColumn = {
  title: string;
  key: string;
  dataIndex?: string;
};

export function getMetricLabelKey(metric: AnalyticsMetricKey): string {
  switch (metric) {
    case "kills":
      return "analytics.metric.kills";
    case "deaths":
      return "analytics.metric.deaths";
    case "assists":
      return "analytics.metric.assists";
    case "damage":
      return "analytics.metric.damage";
    case "healing":
      return "analytics.metric.healing";
    case "building_damage":
      return "analytics.metric.buildingDamage";
    case "credits":
      return "analytics.metric.credits";
    case "damage_taken":
      return "analytics.metric.damageTaken";
    case "kda":
      return "analytics.metric.kda";
    default:
      return metric;
  }
}

export function metricValueFromWarMember(
  row: {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    credits: number | null;
    damage_taken: number | null;
  },
  metric: AnalyticsMetricKey,
): number {
  const normalized = {
    kills: row.kills ?? 0,
    deaths: row.deaths ?? 0,
    assists: row.assists ?? 0,
    damage: row.damage ?? 0,
    healing: row.healing ?? 0,
    building_damage: row.building_damage ?? 0,
    credits: row.credits ?? 0,
    damage_taken: row.damage_taken ?? 0,
  };
  if (metric === "kda") {
    const deaths = normalized.deaths > 0 ? normalized.deaths : 1;
    return Number(((normalized.kills + normalized.assists) / deaths).toFixed(2));
  }
  return normalized[metric];
}

export function metricValueOrNullFromWarMember(
  row: {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    credits: number | null;
    damage_taken: number | null;
  },
  metric: AnalyticsMetricKey,
): number | null {
  if (metric === "kda") {
    if (row.kills === null && row.assists === null && row.deaths === null) {
      return null;
    }
    return metricValueFromWarMember(row, metric);
  }
  const value = row[metric];
  return value === null ? null : value;
}

const LOWER_IS_BETTER_METRICS: Set<AnalyticsMetricKey> = new Set(["deaths", "damage_taken"]);

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
  });

  const analyticsDetailsQuery = useQuery({
    queryKey: queryKeys.guildWar.analyticsDetails(analyticsWarIds.join(",")),
    queryFn: async () => {
      const res = await fetchGuildWarHistoryBatch(analyticsWarIds);
      return res.data;
    },
    enabled: analyticsWarIds.length > 0 && (analyticsMode !== "player" || Boolean(analyticsFocusedUser)),
    staleTime: Infinity,
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
      setModifierWeights({
        kda: analyticsSettings.modifier_weight_kda,
        towers: analyticsSettings.modifier_weight_towers,
        credits: analyticsSettings.modifier_weight_credits,
        distance: analyticsSettings.modifier_weight_distance,
        basehp: analyticsSettings.modifier_weight_basehp,
      });
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
    modifierWeights,
    setModifierWeights,
    referenceDuration,
    analyticsWarOptions,
    analyticsSelectableUserIds: computed.analyticsSelectableUserIds,
    analyticsUserIdToUsername: computed.analyticsUserIdToUsername,
    analyticsTeamOptions: computed.analyticsTeamOptions,
    analyticsMetricLabel: computed.analyticsMetricLabel,
    analyticsChartOption: computed.analyticsChartOption,
    analyticsTableRows: computed.analyticsTableRows,
    analyticsTableColumns: computed.analyticsTableColumns,
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
