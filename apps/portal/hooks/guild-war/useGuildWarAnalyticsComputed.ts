import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyticsAggregation, AnalyticsMetricKey, AnalyticsTableColumn } from "./useGuildWarAnalytics";
import { hashToPaletteColor } from "./useGuildWarAnalytics";

type WarDetail = {
  id: string;
  war_name: string;
  created_at: string;
  result?: string | null;
  member_stats: Array<{
    user_id: string;
    username?: string | null;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    damage: number | null;
    healing: number | null;
    building_damage: number | null;
    credits: number | null;
    damage_taken: number | null;
  }>;
  teams: Array<{
    team_name: string;
    members: Array<{
      user_id: string;
      kills: number | null;
      deaths: number | null;
      assists: number | null;
      damage: number | null;
      healing: number | null;
      building_damage: number | null;
      credits: number | null;
      damage_taken: number | null;
    }>;
  }>;
};

type UseGuildWarAnalyticsComputedParams = {
  analyticsMode: string;
  analyticsSelectedMetrics: AnalyticsMetricKey[];
  analyticsAggregation: AnalyticsAggregation;
  analyticsMinParticipation: number;
  analyticsTopN: number;
  analyticsSelectedTeams: string[];
  analyticsTeamAggregation: "total" | "average";
  analyticsSelectedUsers: string[];
  analyticsNormEnabled: boolean;
  analyticsWarDetails: WarDetail[];
  analyticsRows: Array<{ user_id: string }>;
  warNormContext: Map<string, { durationMinutes: number | null; modifier: number }>;
  referenceDuration: number;
  chartPalette: string[];
  getMetricLabelKey: (metric: AnalyticsMetricKey) => string;
  metricValueFromWarMember: (
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
  ) => number;
  metricValueOrNullFromWarMember: (
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
  ) => number | null;
  normalizeMetricValue: (
    rawValue: number,
    metric: AnalyticsMetricKey,
    durationMinutes: number | null,
    referenceDuration: number,
    modifier: number,
  ) => number;
};

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

export function useGuildWarAnalyticsComputed({
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
}: UseGuildWarAnalyticsComputedParams) {
  const { t } = useTranslation("guild-war");

  const analyticsMetric = analyticsSelectedMetrics[0] ?? "damage";
  const analyticsMetricLabel = t(getMetricLabelKey(analyticsMetric));
  const analyticsMetricLabels = analyticsSelectedMetrics.map((m) => t(getMetricLabelKey(m)));

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

  const analyticsTimeline = useMemo(() => {
    return [...analyticsWarDetails].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
  }, [analyticsWarDetails]);

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
    [analyticsNormEnabled, metricValueFromWarMember, normalizeMetricValue, referenceDuration, warNormContext],
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
    [analyticsNormEnabled, getNormalizedMetricValue, metricValueOrNullFromWarMember, normalizeMetricValue, referenceDuration, warNormContext],
  );

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
    analyticsAggregation,
    analyticsMetricLabel,
    analyticsMetricLabels,
    analyticsMode,
    analyticsPlayerRows,
    analyticsRankingRows,
    analyticsSelectedMetrics,
    analyticsSelectedUsers,
    analyticsTeamSeries,
    analyticsUserIdToUsername,
    chartPalette,
    getMetricLabelKey,
    t,
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
  }, [analyticsMode, analyticsSelectedMetrics, analyticsSelectedUsers, analyticsUserIdToUsername, getMetricLabelKey, t]);

  const analyticsFocusLabel = useMemo(() => {
    if (analyticsMode === "player") {
      return "none";
    }
    if (analyticsMode === "rankings") {
      return `${analyticsAggregation} • top ${analyticsTopN}`;
    }
    return analyticsSelectedTeams.join(", ") || t("analytics.allTeams");
  }, [analyticsAggregation, analyticsMode, analyticsSelectedTeams, analyticsTopN, t]);

  return {
    analyticsSelectableUserIds,
    analyticsUserIdToUsername,
    analyticsTeamOptions,
    analyticsTimeline,
    analyticsMetric,
    analyticsMetricLabel,
    analyticsMetricLabels,
    analyticsRankingRows,
    analyticsTeamSeries,
    analyticsPlayerRows,
    analyticsChartOption,
    analyticsTableRows,
    analyticsTableColumns,
    analyticsFocusLabel,
    getNormalizedMetricValue,
    getNormalizedMetricValueOrNull,
  };
}
