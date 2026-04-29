import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  ANALYTICS_SELECTION_SOFT_CAP,
  GuildWarService,
  fetchGuildWarAnalytics,
  fetchGuildWarHistoryBatch,
} from "../../services/GuildWarService";
import { queryKeys } from "../../api/query-keys";
import { useGuildWarStore, type AnalyticsDatePreset } from "../../stores/guildWar";
import { copyPlainText } from "../../utils/copy";

const message = {
  success: (content: string) => notifications.show({ color: "green", message: content }),
  warning: (content: string) => notifications.show({ color: "yellow", message: content }),
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

function getMetricLabelKey(metric: AnalyticsMetricKey): string {
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

function aggregateValues(values: number[], aggregation: AnalyticsAggregation): number {
  if (values.length === 0) {
    return 0;
  }
  if (aggregation === "best") {
    return Math.max(...values);
  }
  if (aggregation === "median") {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
    }
    return sorted[middle] ?? 0;
  }
  if (aggregation === "average") {
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function metricValueFromWarMember(
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

function metricValueOrNullFromWarMember(
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

function normalizeMetricValue(
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

  const analyticsSelectableUserIds = useMemo(() => {
    const detailIds = analyticsWarDetails.flatMap((war) => war.member_stats.map((member) => member.user_id));
    const aggregatedIds = analyticsRows.map((row) => row.user_id);
    return Array.from(new Set([...detailIds, ...aggregatedIds])).sort();
  }, [analyticsRows, analyticsWarDetails]);

  const analyticsUserIdToUsername = useMemo(() => {
    const map = new Map<string, string>();
    for (const war of analyticsWarDetails) {
      for (const member of war.member_stats) {
        if (member.username && !map.has(member.user_id)) {
          map.set(member.user_id, member.username);
        }
      }
    }
    return map;
  }, [analyticsWarDetails]);

  const analyticsTeamOptions = useMemo(() => {
    const names = analyticsWarDetails.flatMap((war) => war.teams.map((team) => team.team_name));
    return Array.from(new Set(names)).sort();
  }, [analyticsWarDetails]);

  const analyticsMetric = analyticsSelectedMetrics[0] ?? "damage";
  const analyticsMetricLabel = t(getMetricLabelKey(analyticsMetric));
  const analyticsMetricLabels = analyticsSelectedMetrics.map((m) => t(getMetricLabelKey(m)));

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

  const getNormalizedMetricValue = useCallback(
    (warId: string, member: Parameters<typeof metricValueFromWarMember>[0], metric: AnalyticsMetricKey): number => {
      const raw = metricValueFromWarMember(member, metric);
      if (!analyticsNormEnabled) return raw;
      const ctx = warNormContext.get(warId);
      if (!ctx) return raw;
      if (metric === "kda") {
        const normK = normalizeMetricValue(member.kills ?? 0, "kills", ctx.durationMinutes, referenceDuration, ctx.modifier);
        const normD = normalizeMetricValue(member.deaths ?? 0, "deaths", ctx.durationMinutes, referenceDuration, ctx.modifier);
        const normA = normalizeMetricValue(member.assists ?? 0, "assists", ctx.durationMinutes, referenceDuration, ctx.modifier);
        return Number(((normK + normA) / Math.max(normD, 1)).toFixed(2));
      }
      return normalizeMetricValue(raw, metric, ctx.durationMinutes, referenceDuration, ctx.modifier);
    },
    [analyticsNormEnabled, referenceDuration, warNormContext],
  );

  const getNormalizedMetricValueOrNull = useCallback(
    (warId: string, member: Parameters<typeof metricValueOrNullFromWarMember>[0], metric: AnalyticsMetricKey): number | null => {
      const raw = metricValueOrNullFromWarMember(member, metric);
      if (raw === null) return null;
      if (!analyticsNormEnabled) return raw;
      const ctx = warNormContext.get(warId);
      if (!ctx) return raw;
      if (metric === "kda") {
        return getNormalizedMetricValue(warId, member, metric);
      }
      return normalizeMetricValue(raw, metric, ctx.durationMinutes, referenceDuration, ctx.modifier);
    },
    [analyticsNormEnabled, getNormalizedMetricValue, referenceDuration, warNormContext],
  );

  useEffect(() => {
    if (!analyticsFocusedUser && analyticsSelectableUserIds.length > 0) {
      setAnalyticsFocusedUser(analyticsSelectableUserIds[0] ?? "");
    }
  }, [analyticsFocusedUser, analyticsSelectableUserIds]);

  useEffect(() => {
    if (analyticsSelectedWarIds.length > 0) {
      setAnalyticsDatePreset("all");
    }
  }, [analyticsSelectedWarIds]);

  const analyticsTimeline = useMemo(() => {
    return [...analyticsWarDetails].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
  }, [analyticsWarDetails]);

  const analyticsRankingRows = useMemo(() => {
    const valuesByUser = new Map<string, number[]>();
    for (const war of analyticsTimeline) {
      for (const member of war.member_stats) {
        const current = valuesByUser.get(member.user_id) ?? [];
        current.push(getNormalizedMetricValue(war.id, member, analyticsMetric));
        valuesByUser.set(member.user_id, current);
      }
    }
    return Array.from(valuesByUser.entries())
      .map(([userId, values]) => ({
        key: userId,
        user_id: userId,
        participation: values.length,
        score: Number(aggregateValues(values, analyticsAggregation).toFixed(2)),
      }))
      .filter((row) => row.participation >= analyticsMinParticipation)
      .sort((left, right) => right.score - left.score)
      .slice(0, analyticsTopN);
  }, [analyticsAggregation, analyticsMetric, analyticsMinParticipation, analyticsTimeline, analyticsTopN, getNormalizedMetricValue]);

  const analyticsTeamSeries = useMemo(() => {
    const seriesMap = new Map<string, Array<{ warId: string; warName: string; value: number }>>();
    for (const war of analyticsTimeline) {
      for (const team of war.teams) {
        if (analyticsSelectedTeams.length > 0 && !analyticsSelectedTeams.includes(team.team_name)) {
          continue;
        }
        const values = team.members.map((member) => getNormalizedMetricValue(war.id, member, analyticsMetric));
        const score =
          analyticsTeamAggregation === "average"
            ? Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2))
            : values.reduce((sum, value) => sum + value, 0);
        const current = seriesMap.get(team.team_name) ?? [];
        current.push({
          warId: war.id,
          warName: war.war_name,
          value: Number(score.toFixed(2)),
        });
        seriesMap.set(team.team_name, current);
      }
    }
    return Array.from(seriesMap.entries()).map(([teamName, points]) => ({
      teamName,
      points,
    }));
  }, [analyticsMetric, analyticsSelectedTeams, analyticsTeamAggregation, analyticsTimeline, getNormalizedMetricValue]);

  const analyticsPlayerRows = useMemo(() => {
    if (analyticsSelectedUsers.length === 0) return [];
    return analyticsTimeline.map((war) => {
      const row: Record<string, unknown> = {
        key: war.id,
        war_name: war.war_name,
        created_at: war.created_at,
        result: war.result ?? "-",
      };
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        const member = war.member_stats.find((item) => item.user_id === userId);
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          row[`user${userIndex}_metric${metricIndex}`] = member ? getNormalizedMetricValueOrNull(war.id, member, metric) : null;
        });
      });
      return row;
    });
  }, [analyticsSelectedUsers, analyticsSelectedMetrics, analyticsTimeline, getNormalizedMetricValueOrNull]);

  const analyticsChartOption = useMemo(() => {
    if (analyticsMode === "player") {
      const series: Array<{ type: string; name: string; smooth: boolean; data: unknown[] }> = [];
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          series.push({
            type: "line",
            name: `${analyticsUserIdToUsername.get(userId) ?? userId} - ${t(getMetricLabelKey(metric))}`,
            smooth: true,
            data: analyticsPlayerRows.map((row) => row[`user${userIndex}_metric${metricIndex}`]),
          });
        });
      });
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll" },
        xAxis: { type: "category", data: analyticsPlayerRows.map((row) => row.war_name), axisLabel: { rotate: 18 } },
        yAxis: { type: "value" },
        series,
      };
    }

    if (analyticsMode === "rankings") {
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        xAxis: { type: "value" },
        yAxis: {
          type: "category",
          data: analyticsRankingRows.map((row) => analyticsUserIdToUsername.get(row.user_id) ?? row.user_id),
          axisLabel: { interval: 0 },
        },
        series: [
          {
            type: "bar",
            name: `${analyticsAggregation} ${analyticsMetricLabel}`,
            data: analyticsRankingRows.map((row) => ({
              value: row.score,
              itemStyle: { color: hashToPaletteColor(row.user_id, chartPalette) },
            })),
          },
        ],
      };
    }

    const firstSeries = analyticsTeamSeries[0];
    return {
      color: chartPalette,
      tooltip: { trigger: "axis" },
      legend: { type: "scroll" },
      xAxis: {
        type: "category",
        data: firstSeries ? firstSeries.points.map((point) => point.warName) : [],
        axisLabel: { rotate: 18 },
      },
      yAxis: { type: "value" },
      series: analyticsTeamSeries.map((series) => ({
        type: "bar",
        name: series.teamName,
        data: series.points.map((point) => point.value),
      })),
    };
  }, [
    analyticsMetric,
    analyticsMetricLabel,
    analyticsMetricLabels,
    analyticsMode,
    analyticsPlayerRows,
    analyticsRankingRows,
    analyticsSelectedMetrics,
    analyticsTeamSeries,
    analyticsTimeline,
    analyticsAggregation,
    chartPalette,
  ]);

  const analyticsTableRows = useMemo(() => {
    if (analyticsMode === "player") {
      return analyticsPlayerRows;
    }
    if (analyticsMode === "rankings") {
      return analyticsRankingRows.map((row, index) => ({ ...row, rank: index + 1, user_id: analyticsUserIdToUsername.get(row.user_id) ?? row.user_id }));
    }
    return analyticsTeamSeries.map((series) => {
      const values = series.points.map((point) => point.value);
      return {
        key: series.teamName,
        team_name: series.teamName,
        wars: series.points.length,
        total: Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)),
        average: Number(
          (values.reduce((sum, value) => sum + value, 0) / Math.max(1, series.points.length)).toFixed(2),
        ),
      };
    });
  }, [analyticsMode, analyticsPlayerRows, analyticsRankingRows, analyticsTeamSeries, analyticsUserIdToUsername]);

  const analyticsTableColumns = useMemo<AnalyticsTableColumn[]>(() => {
    if (analyticsMode === "player") {
      const columns: AnalyticsTableColumn[] = [
        { title: t("analytics.table.war"), dataIndex: "war_name", key: "war_name" },
        { title: t("analytics.table.date"), dataIndex: "created_at", key: "created_at" },
        { title: t("analytics.table.result"), dataIndex: "result", key: "result" },
      ];
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          columns.push({
            title: `${analyticsUserIdToUsername.get(userId) ?? userId} - ${t(getMetricLabelKey(metric))}`,
            dataIndex: `user${userIndex}_metric${metricIndex}`,
            key: `user${userIndex}_metric${metricIndex}`,
          });
        });
      });
      return columns;
    }
    if (analyticsMode === "rankings") {
      return [
        { title: t("analytics.table.rank"), dataIndex: "rank", key: "rank" },
        { title: t("analytics.table.member"), dataIndex: "user_id", key: "user_id" },
        { title: t("analytics.table.wars"), dataIndex: "participation", key: "participation" },
        { title: t("analytics.table.score"), dataIndex: "score", key: "score" },
      ];
    }
    return [
      { title: t("analytics.table.team"), dataIndex: "team_name", key: "team_name" },
      { title: t("analytics.table.wars"), dataIndex: "wars", key: "wars" },
      { title: t("analytics.table.total"), dataIndex: "total", key: "total" },
      { title: t("analytics.table.average"), dataIndex: "average", key: "average" },
    ];
  }, [analyticsMode, analyticsSelectedMetrics, analyticsSelectedUsers, t]);

  const analyticsFocusLabel = useMemo(() => {
    if (analyticsMode === "player") {
      return analyticsFocusedUser || "none";
    }
    if (analyticsMode === "rankings") {
      return `${analyticsAggregation} • top ${analyticsTopN}`;
    }
    return analyticsSelectedTeams.join(", ") || t("analytics.allTeams");
  }, [
    analyticsAggregation,
    analyticsFocusedUser,
    analyticsMode,
    analyticsSelectedTeams,
    analyticsTopN,
  ]);

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
      `Metric: ${analyticsMetricLabel}`,
      `Wars: ${analyticsWarsCount}`,
      `Focus: ${analyticsFocusLabel}`,
      ...analyticsTableRows
        .slice(0, 5)
        .map((row, index) => `${index + 1}. ${JSON.stringify(row)}`),
    ];
    await copyPlainText(lines.join("\n"));
    message.success(t("message.snapshotCopied"));
  };

  const copyAnalyticsCsv = async () => {
    const headers = analyticsTableColumns
      .map((column) => ("dataIndex" in column ? String(column.dataIndex) : column.key))
      .filter((value): value is string => Boolean(value));
    const lines = [headers.join(",")];
    for (const row of analyticsTableRows as Array<Record<string, unknown>>) {
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
    // queries
    analyticsQuery,
    analyticsDetailsQuery,
    analyticsWarIds,
    // store state pass-through
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
    // derived
    analyticsWarOptions,
    analyticsSelectableUserIds,
    analyticsUserIdToUsername,
    analyticsTeamOptions,
    analyticsMetricLabel,
    analyticsChartOption,
    analyticsTableRows,
    analyticsTableColumns,
    analyticsFocusLabel,
    // handlers
    applyAnalyticsSelection,
    copyAnalyticsSnapshot,
    copyAnalyticsCsv,
    handleAnalyticsDatePresetChange,
    // re-exports for WarHistoryTab
    getNormalizedMetricValue,
    getNormalizedMetricValueOrNull,
    metricValueFromWarMember,
    metricValueOrNullFromWarMember,
    getMetricLabelKey,
    hashToPaletteColor,
    selectionSoftCap: ANALYTICS_SELECTION_SOFT_CAP,
  };
}

export type { AnalyticsMetricKey, AnalyticsAggregation, AnalyticsTableColumn };
