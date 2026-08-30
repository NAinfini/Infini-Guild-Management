import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_GAME_RULES, GUILD_WAR_KDA_KEY, evaluateKda, findGuildWarResultDefinition } from "@guild/shared";
import type { AnalyticsAggregation, AnalyticsMetricKey, AnalyticsTableColumn } from "../../types/guild-war";
import { localDateKey } from "@portal/utils/datetime";
import { aggregateValues, computeStdDev, hashToPaletteColor } from "@portal/utils/guild-war-analytics";
import { getGuildWarResultLabel } from "@portal/utils/game-rules";

type WarDetail = {
  id: string;
  war_name: string;
  created_at: string;
  result?: string | null;
  member_stats: Array<{
    user_id: string;
    display_name?: string | null;
    avatar_media_id?: string | null;
    stats: Record<string, number | null> | null;
  }>;
  teams: Array<{
    team_name: string;
    members: Array<{
      user_id: string;
      stats: Record<string, number | null> | null;
    }>;
  }>;
  pool?: Array<{
    userId: string;
    display_name?: string | null;
  }>;
};

type AnalyticsWar = {
  id: string;
  war_name: string;
  created_at: string;
  enemy_name: string | null;
  result: string | null;
  own_stats: Record<string, number | null> | null;
  enemy_stats: Record<string, number | null> | null;
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
  analyticsOnlyParticipated: boolean;
  analyticsNormEnabled: boolean;
  analyticsShowDeviation: boolean;
  analyticsShowContribution: boolean;
  analyticsWarDetails: WarDetail[];
  analyticsWars: AnalyticsWar[];
  analyticsWarStat: string;
  analyticsRows: Array<{ user_id: string }>;
  analyticsAbsences: Array<{ user_id: string; start_date: string; end_date: string }>;
  warNormContext: Map<string, { durationMinutes: number | null; modifier: number }>;
  referenceDuration: number;
  chartPalette: string[];
  getMetricLabelKey: (metric: AnalyticsMetricKey) => string;
  metricValueFromWarMember: (
    row: {
      stats: Record<string, number | null> | null;
    },
    metric: AnalyticsMetricKey,
  ) => number;
  metricValueOrNullFromWarMember: (
    row: {
      stats: Record<string, number | null> | null;
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

export function useGuildWarAnalyticsComputed({
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
  analyticsWars,
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
}: UseGuildWarAnalyticsComputedParams) {
  const { t } = useTranslation("guild-war");
  const gameRules = DEFAULT_GAME_RULES;
  const warRules = gameRules.guild_war;

  const analyticsMetric = analyticsSelectedMetrics[0] ?? warRules.default_member_stat_key;
  const analyticsMetricLabel = getMetricLabelKey(analyticsMetric);
  const analyticsMetricLabels = analyticsSelectedMetrics.map((metric) => getMetricLabelKey(metric));

  const analyticsSelectableUserIds = useMemo(() => {
    const detailIds = analyticsWarDetails.flatMap((war) => war.member_stats.map((member) => member.user_id));
    const aggregatedIds = analyticsRows.map((row) => row.user_id);
    return Array.from(new Set([...detailIds, ...aggregatedIds])).sort();
  }, [analyticsRows, analyticsWarDetails]);

  const analyticsUserIdToUsername = useMemo(() => {
    const map = new Map<string, string>();
    for (const war of analyticsWarDetails) {
      for (const member of war.member_stats) {
        if (member.display_name && !map.has(member.user_id)) {
          map.set(member.user_id, member.display_name);
        }
      }
      for (const poolMember of war.pool ?? []) {
        if (poolMember.display_name && !map.has(poolMember.userId)) {
          map.set(poolMember.userId, poolMember.display_name);
        }
      }
    }
    return map;
  }, [analyticsWarDetails]);

  const analyticsUserIdToAvatarMediaId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const war of analyticsWarDetails) {
      for (const member of war.member_stats) {
        if (!map.has(member.user_id) || member.avatar_media_id) {
          map.set(member.user_id, member.avatar_media_id ?? null);
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

  // Player mode: optionally drop wars where none of the selected members fought,
  // so absent wars don't render as empty x-axis gaps.
  const playerTimeline = useMemo(() => {
    if (!analyticsOnlyParticipated || analyticsSelectedUsers.length === 0) {
      return analyticsTimeline;
    }
    return analyticsTimeline.filter((war) =>
      analyticsSelectedUsers.some((userId) => war.member_stats.some((member) => member.user_id === userId)),
    );
  }, [analyticsOnlyParticipated, analyticsSelectedUsers, analyticsTimeline]);

  // Wars mode: war-level own vs enemy comparison for the selected objective stat.
  const analyticsWarOverviewRows = useMemo(() => {
    const sorted = [...analyticsWars].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
    return sorted.map((war) => {
      const own = war.own_stats?.[analyticsWarStat] ?? null;
      const enemy = war.enemy_stats?.[analyticsWarStat] ?? null;
      return {
        key: war.id,
        war_name: war.war_name,
        created_at: localDateKey(war.created_at),
        enemy_name: war.enemy_name ?? "—",
        result_id: war.result,
        result: war.result ? getGuildWarResultLabel(war.result) : "—",
        own,
        enemy,
        margin: own !== null && enemy !== null ? own - enemy : null,
      };
    });
  }, [analyticsWars, analyticsWarStat, t]);

  const analyticsWarSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const war of analyticsWars) {
      if (war.result) counts.set(war.result, (counts.get(war.result) ?? 0) + 1);
    }
    const decided = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    const wins = Array.from(counts.entries()).reduce((sum, [resultId, count]) => (
      findGuildWarResultDefinition(resultId)?.outcome === "win" ? sum + count : sum
    ), 0);
    return {
      counts,
      decided,
      winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(0)) : null,
    };
  }, [analyticsWars, gameRules]);

  const getNormalizedMetricValue = useCallback(
    (warId: string, member: Parameters<typeof metricValueFromWarMember>[0], metric: AnalyticsMetricKey): number => {
      const raw = metricValueFromWarMember(member, metric);
      if (!analyticsNormEnabled) return raw;
      const ctx = warNormContext.get(warId);
      if (!ctx) return raw;
      if (metric === GUILD_WAR_KDA_KEY) {
        const dependencyKeys = ["kills", "assists", "deaths"];
        const normalizedStats = Object.fromEntries(Array.from(dependencyKeys).map((key) => [
          key,
          normalizeMetricValue(member.stats?.[key] ?? 0, key, ctx.durationMinutes, referenceDuration, ctx.modifier),
        ]));
        return evaluateKda(normalizedStats);
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
      if (metric === GUILD_WAR_KDA_KEY) {
        return getNormalizedMetricValue(warId, member, metric);
      }
      return normalizeMetricValue(raw, metric, ctx.durationMinutes, referenceDuration, ctx.modifier);
    },
    [analyticsNormEnabled, getNormalizedMetricValue, metricValueOrNullFromWarMember, normalizeMetricValue, referenceDuration, warNormContext],
  );

  const analyticsRankingRows = useMemo(() => {
    const primaryMetric = analyticsSelectedMetrics[0] ?? warRules.default_member_stat_key;
    const valuesByUser = new Map<string, number[]>();
    const poolEntriesByUser = new Map<string, Array<{ warId: string; date: string }>>();
    const foughtWarIdsByUser = new Map<string, Set<string>>();
    for (const war of analyticsTimeline) {
      const warDate = localDateKey(war.created_at);
      for (const member of war.member_stats) {
        const current = valuesByUser.get(member.user_id) ?? [];
        current.push(getNormalizedMetricValue(war.id, member, primaryMetric));
        valuesByUser.set(member.user_id, current);
        const fought = foughtWarIdsByUser.get(member.user_id) ?? new Set<string>();
        fought.add(war.id);
        foughtWarIdsByUser.set(member.user_id, fought);
      }
      for (const poolMember of war.pool ?? []) {
        const entries = poolEntriesByUser.get(poolMember.userId) ?? [];
        entries.push({ warId: war.id, date: warDate });
        poolEntriesByUser.set(poolMember.userId, entries);
      }
    }
    // Rostered-but-never-fought members surface when min participation is 0.
    for (const userId of poolEntriesByUser.keys()) {
      if (!valuesByUser.has(userId)) valuesByUser.set(userId, []);
    }
    const absenceRangesByUser = new Map<string, Array<{ start: string; end: string }>>();
    for (const absence of analyticsAbsences) {
      const ranges = absenceRangesByUser.get(absence.user_id) ?? [];
      ranges.push({ start: absence.start_date, end: absence.end_date });
      absenceRangesByUser.set(absence.user_id, ranges);
    }
    return Array.from(valuesByUser.entries())
      .map(([userId, values]) => {
        const poolEntries = poolEntriesByUser.get(userId) ?? [];
        // Rostered-but-not-fought wars covered by a reported absence are excused
        // from the attendance denominator.
        const fought = foughtWarIdsByUser.get(userId);
        const ranges = absenceRangesByUser.get(userId) ?? [];
        const excused = poolEntries.filter(
          (entry) =>
            !fought?.has(entry.warId)
            && ranges.some((range) => range.start <= entry.date && entry.date <= range.end),
        ).length;
        // Missing pool snapshots must never produce attendance above 100%.
        const poolWars = Math.max(poolEntries.length, values.length);
        const effectivePool = Math.max(poolWars - excused, values.length);
        return {
          key: userId,
          user_id: userId,
          participation: values.length,
          poolWars,
          excused,
          attendanceRate: effectivePool > 0 ? Number(((values.length / effectivePool) * 100).toFixed(0)) : null,
          score: Number(aggregateValues(values, analyticsAggregation).toFixed(2)),
          stdDev: computeStdDev(values),
        };
      })
      .filter((row) => row.participation >= analyticsMinParticipation)
      .sort((left, right) => right.score - left.score)
      .slice(0, analyticsTopN);
  }, [analyticsAbsences, analyticsAggregation, analyticsSelectedMetrics, analyticsMinParticipation, analyticsTimeline, analyticsTopN, getNormalizedMetricValue, warRules.default_member_stat_key]);

  const analyticsRankingRowsByMetric = useMemo(() => {
    const userPool = new Set(analyticsRankingRows.map((row) => row.user_id));
    const result = new Map<AnalyticsMetricKey, Map<string, number>>();
    for (const metric of analyticsSelectedMetrics) {
      const valuesByUser = new Map<string, number[]>();
      for (const war of analyticsTimeline) {
        for (const member of war.member_stats) {
          if (!userPool.has(member.user_id)) continue;
          const current = valuesByUser.get(member.user_id) ?? [];
          current.push(getNormalizedMetricValue(war.id, member, metric));
          valuesByUser.set(member.user_id, current);
        }
      }
      const scores = new Map<string, number>();
      for (const [userId, values] of valuesByUser) {
        scores.set(userId, Number(aggregateValues(values, analyticsAggregation).toFixed(2)));
      }
      result.set(metric, scores);
    }
    return result;
  }, [analyticsAggregation, analyticsRankingRows, analyticsSelectedMetrics, analyticsTimeline, getNormalizedMetricValue]);

  const analyticsTeamSeries = useMemo(() => {
    const primaryMetric = analyticsSelectedMetrics[0] ?? warRules.default_member_stat_key;
    const seriesMap = new Map<string, Array<{ warId: string; warName: string; value: number }>>();
    for (const war of analyticsTimeline) {
      for (const team of war.teams) {
        if (analyticsSelectedTeams.length > 0 && !analyticsSelectedTeams.includes(team.team_name)) {
          continue;
        }
        const values = team.members.map((member) => getNormalizedMetricValue(war.id, member, primaryMetric));
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
  }, [analyticsSelectedMetrics, analyticsSelectedTeams, analyticsTeamAggregation, analyticsTimeline, getNormalizedMetricValue]);

  const analyticsTeamSeriesByMetric = useMemo(() => {
    if (analyticsSelectedMetrics.length <= 1) return null;
    const result = new Map<AnalyticsMetricKey, Array<{ teamName: string; points: Array<{ warName: string; value: number }> }>>();
    for (const metric of analyticsSelectedMetrics) {
      const seriesMap = new Map<string, Array<{ warName: string; value: number }>>();
      for (const war of analyticsTimeline) {
        for (const team of war.teams) {
          if (analyticsSelectedTeams.length > 0 && !analyticsSelectedTeams.includes(team.team_name)) continue;
          const values = team.members.map((member) => getNormalizedMetricValue(war.id, member, metric));
          const score =
            analyticsTeamAggregation === "average"
              ? Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(2))
              : values.reduce((sum, value) => sum + value, 0);
          const current = seriesMap.get(team.team_name) ?? [];
          current.push({ warName: war.war_name, value: Number(score.toFixed(2)) });
          seriesMap.set(team.team_name, current);
        }
      }
      result.set(metric, Array.from(seriesMap.entries()).map(([teamName, points]) => ({ teamName, points })));
    }
    return result;
  }, [analyticsSelectedMetrics, analyticsSelectedTeams, analyticsTeamAggregation, analyticsTimeline, getNormalizedMetricValue]);

  const analyticsPlayerRows = useMemo(() => {
    if (analyticsSelectedUsers.length === 0) return [];
    return playerTimeline.map((war) => {
      const row: Record<string, unknown> = {
        key: war.id,
        war_name: war.war_name,
        created_at: localDateKey(war.created_at),
        result: war.result ? getGuildWarResultLabel(war.result) : "—",
      };
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        const member = war.member_stats.find((item) => item.user_id === userId);
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          row[`user${userIndex}_metric${metricIndex}`] = member ? getNormalizedMetricValueOrNull(war.id, member, metric) : null;
        });
      });
      return row;
    });
  }, [analyticsSelectedUsers, analyticsSelectedMetrics, playerTimeline, getNormalizedMetricValueOrNull, t]);

  const analyticsChartOption = useMemo(() => {
    if (analyticsMode === "wars") {
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll" },
        xAxis: {
          type: "category",
          data: analyticsWarOverviewRows.map((row) => row.war_name),
          axisLabel: { rotate: 18 },
        },
        yAxis: { type: "value" },
        series: [
          {
            type: "bar",
            name: t("analytics.wars.own"),
            barMaxWidth: 30,
            itemStyle: { borderRadius: [4, 4, 0, 0] },
            data: analyticsWarOverviewRows.map((row) => row.own),
          },
          {
            type: "bar",
            name: t("analytics.wars.enemy"),
            barMaxWidth: 30,
            itemStyle: { borderRadius: [4, 4, 0, 0] },
            data: analyticsWarOverviewRows.map((row) => row.enemy),
          },
        ],
      };
    }

    if (analyticsMode === "player") {
      const series: Array<{ type: string; name: string; smooth: boolean; data: unknown[] }> = [];

      if (analyticsShowDeviation) {
        // Deviation mode: compute team average per war per metric, show % deviation
        analyticsSelectedUsers.forEach((userId, userIndex) => {
          analyticsSelectedMetrics.forEach((metric, metricIndex) => {
            const data = playerTimeline.map((war) => {
              const allValues = war.member_stats.map((m) => getNormalizedMetricValue(war.id, m, metric));
              const teamAvg = allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0;
              const playerVal = analyticsPlayerRows.find((r) => r.key === war.id)?.[`user${userIndex}_metric${metricIndex}`] as number | null;
              if (playerVal === null || teamAvg === 0) return null;
              return Number(((playerVal - teamAvg) / teamAvg * 100).toFixed(1));
            });
            series.push({
              type: "line",
              name: `${analyticsUserIdToUsername.get(userId) ?? userId} - ${getMetricLabelKey(metric)}`,
              smooth: true,
              data,
            });
          });
        });
        return {
          color: chartPalette,
          tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v}%` },
          legend: { type: "scroll" },
          xAxis: { type: "category", data: analyticsPlayerRows.map((row) => row.war_name), axisLabel: { rotate: 18 } },
          yAxis: { type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { type: "dashed" } } },
          series,
        };
      }

      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          series.push({
            type: "line",
            name: `${analyticsUserIdToUsername.get(userId) ?? userId} - ${getMetricLabelKey(metric)}`,
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
      const yAxisLabels = analyticsRankingRows.map((row) => analyticsUserIdToUsername.get(row.user_id) ?? row.user_id);
      if (analyticsSelectedMetrics.length <= 1) {
        return {
          color: chartPalette,
          tooltip: { trigger: "axis" },
          xAxis: { type: "value" },
          yAxis: {
            type: "category",
            data: yAxisLabels,
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
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll" },
        xAxis: { type: "value" },
        yAxis: {
          type: "category",
          data: yAxisLabels,
          axisLabel: { interval: 0 },
        },
        series: analyticsSelectedMetrics.map((metric, idx) => {
          const scores = analyticsRankingRowsByMetric.get(metric);
          return {
            type: "bar",
            name: getMetricLabelKey(metric),
            data: analyticsRankingRows.map((row) => scores?.get(row.user_id) ?? 0),
            itemStyle: { color: chartPalette[idx % chartPalette.length] },
          };
        }),
      };
    }

    // Teams mode
    const firstSeries = analyticsTeamSeries[0];

    if (analyticsShowContribution) {
      /* Contribution mode normalizes each team independently and renders one stack per team. */
      const warNames = firstSeries ? firstSeries.points.map((p) => p.warName) : [];
      const primaryMetric = analyticsSelectedMetrics[0] ?? warRules.default_member_stat_key;
      const isSelectedTeam = (teamName: string) =>
        analyticsSelectedTeams.length === 0 || analyticsSelectedTeams.includes(teamName);

      const teamNames: string[] = [];
      for (const war of analyticsTimeline) {
        for (const team of war.teams) {
          if (isSelectedTeam(team.team_name) && !teamNames.includes(team.team_name)) {
            teamNames.push(team.team_name);
          }
        }
      }

      // Limit named members per team and aggregate the remainder so every stack
      // still represents 100% of the team's contribution.
      const NAMED_PER_TEAM = 12;
      const contributionSeries: Array<{
        type: string;
        name: string;
        stack: string;
        data: number[];
      }> = [];

      for (const teamName of teamNames) {
        const totalsPerWar = analyticsTimeline.map((war) => {
          let total = 0;
          for (const team of war.teams) {
            if (team.team_name !== teamName) continue;
            for (const m of team.members) total += getNormalizedMetricValue(war.id, m, primaryMetric);
          }
          return total;
        });

        const teamUserIds = new Set<string>();
        for (const war of analyticsTimeline) {
          for (const team of war.teams) {
            if (team.team_name !== teamName) continue;
            for (const m of team.members) teamUserIds.add(m.user_id);
          }
        }

        const byUser = Array.from(teamUserIds)
          .map((userId) => {
            const data = analyticsTimeline.map((war, warIdx) => {
              const total = totalsPerWar[warIdx] ?? 0;
              if (total === 0) return 0;
              let value = 0;
              for (const team of war.teams) {
                if (team.team_name !== teamName) continue;
                const member = team.members.find((m) => m.user_id === userId);
                if (member) value += getNormalizedMetricValue(war.id, member, primaryMetric);
              }
              return Number(((value / total) * 100).toFixed(1));
            });
            return { userId, data, share: data.reduce((sum, value) => sum + value, 0) };
          })
          .sort((a, b) => b.share - a.share);

        for (const entry of byUser.slice(0, NAMED_PER_TEAM)) {
          contributionSeries.push({
            type: "bar",
            stack: teamName,
            // The team prefix is what makes the legend readable: the same
            // person can appear under two teams across the selected wars.
            name: `${teamName} · ${analyticsUserIdToUsername.get(entry.userId) ?? entry.userId}`,
            data: entry.data,
          });
        }
        const remainder = byUser.slice(NAMED_PER_TEAM);
        if (remainder.length > 0) {
          contributionSeries.push({
            type: "bar",
            stack: teamName,
            name: `${teamName} · ${t("analytics.contribution.others", { count: remainder.length })}`,
            data: analyticsTimeline.map((_, warIdx) =>
              Number(
                remainder
                  .reduce((sum, entry) => sum + (entry.data[warIdx] ?? 0), 0)
                  .toFixed(1),
              ),
            ),
          });
        }
      }

      return {
        color: chartPalette,
        /*
         * An axis tooltip would now list every member of every team for that
         * war — dozens of rows. Item trigger answers what the hovered segment
         * actually asks: which team, which member, what share.
         */
        tooltip: { trigger: "item", valueFormatter: (v: number) => `${v}%` },
        legend: { type: "scroll" },
        xAxis: { type: "category", data: warNames, axisLabel: { rotate: 18 } },
        yAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
        series: contributionSeries,
      };
    }

    if (analyticsTeamSeriesByMetric && analyticsSelectedMetrics.length > 1) {
      const warNames = firstSeries ? firstSeries.points.map((point) => point.warName) : [];
      const series: Array<{ type: string; name: string; data: number[]; stack?: string }> = [];
      for (const metric of analyticsSelectedMetrics) {
        const metricSeries = analyticsTeamSeriesByMetric.get(metric) ?? [];
        for (const ts of metricSeries) {
          series.push({
            type: "bar",
            name: `${ts.teamName} - ${getMetricLabelKey(metric)}`,
            data: ts.points.map((point) => point.value),
          });
        }
      }
      return {
        color: chartPalette,
        tooltip: { trigger: "axis" },
        legend: { type: "scroll" },
        xAxis: {
          type: "category",
          data: warNames,
          axisLabel: { rotate: 18 },
        },
        yAxis: { type: "value" },
        series,
      };
    }
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
    analyticsMode,
    analyticsPlayerRows,
    analyticsRankingRows,
    analyticsRankingRowsByMetric,
    analyticsSelectedMetrics,
    analyticsSelectedTeams,
    analyticsSelectedUsers,
    analyticsShowContribution,
    analyticsShowDeviation,
    analyticsTeamSeries,
    analyticsTeamSeriesByMetric,
    analyticsTimeline,
    analyticsUserIdToUsername,
    analyticsWarOverviewRows,
    chartPalette,
    getNormalizedMetricValue,
    getMetricLabelKey,
    playerTimeline,
    t,
  ]);

  // Radar chart option: spider chart showing multi-metric profile per selected player
  const analyticsRadarOption = useMemo(() => {
    if (analyticsMode !== "radar") return null;
    const metricsToUse: AnalyticsMetricKey[] = analyticsSelectedMetrics.length > 0
      ? analyticsSelectedMetrics
      : [
          ...warRules.member_stats.map((definition) => definition.key),
          GUILD_WAR_KDA_KEY,
        ];

    // Normalize aggregated profiles against aggregated peers. Comparing a
    // multi-war total to a single-war maximum can exceed the radar's 100 scale.
    const metricMaxes = new Map<AnalyticsMetricKey, number>();
    const metricScores = new Map<AnalyticsMetricKey, Map<string, number>>();
    for (const metric of metricsToUse) {
      const valuesByUser = new Map<string, number[]>();
      for (const war of analyticsTimeline) {
        for (const member of war.member_stats) {
          const values = valuesByUser.get(member.user_id) ?? [];
          values.push(getNormalizedMetricValue(war.id, member, metric));
          valuesByUser.set(member.user_id, values);
        }
      }
      const scores = new Map(
        Array.from(valuesByUser, ([userId, values]) => [
          userId,
          aggregateValues(values, analyticsAggregation),
        ]),
      );
      metricScores.set(metric, scores);
      metricMaxes.set(metric, Math.max(1, ...scores.values()));
    }

    const userProfiles = analyticsSelectedUsers.map((userId) => {
      const values = metricsToUse.map((metric) => {
        const aggregated = metricScores.get(metric)?.get(userId) ?? 0;
        const max = metricMaxes.get(metric) ?? 1;
        return Number((aggregated / max * 100).toFixed(1));
      });
      return {
        name: analyticsUserIdToUsername.get(userId) ?? userId,
        value: values,
      };
    });

    return {
      color: chartPalette,
      tooltip: {},
      legend: { type: "scroll", data: userProfiles.map((p) => p.name) },
      radar: {
        indicator: metricsToUse.map((metric) => ({
          name: getMetricLabelKey(metric),
          max: 100,
        })),
        shape: "polygon",
      },
      series: [{
        type: "radar",
        data: userProfiles,
        areaStyle: { opacity: 0.15 },
      }],
    };
  }, [
    analyticsAggregation,
    analyticsMode,
    analyticsSelectedMetrics,
    analyticsSelectedUsers,
    analyticsTimeline,
    analyticsUserIdToUsername,
    chartPalette,
    getNormalizedMetricValue,
    getMetricLabelKey,
    t,
    warRules,
  ]);

  const analyticsTableRows = useMemo(() => {
    if (analyticsMode === "wars") {
      return analyticsWarOverviewRows;
    }
    if (analyticsMode === "player") {
      return analyticsPlayerRows;
    }
    if (analyticsMode === "rankings") {
      return analyticsRankingRows.map((row, index) => {
        const base: Record<string, unknown> = {
          ...row,
          rank: index + 1,
          user_id: analyticsUserIdToUsername.get(row.user_id) ?? row.user_id,
        };
        if (analyticsSelectedMetrics.length > 1) {
          for (const metric of analyticsSelectedMetrics) {
            const scores = analyticsRankingRowsByMetric.get(metric);
            base[`metric_${metric}`] = scores?.get(row.user_id) ?? 0;
          }
        }
        return base;
      });
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
  }, [analyticsMode, analyticsPlayerRows, analyticsRankingRows, analyticsRankingRowsByMetric, analyticsSelectedMetrics, analyticsTeamSeries, analyticsUserIdToUsername, analyticsWarOverviewRows]);

  const analyticsTableColumns = useMemo<AnalyticsTableColumn[]>(() => {
    if (analyticsMode === "wars") {
      return [
        { title: t("analytics.table.war"), dataIndex: "war_name", key: "war_name" },
        { title: t("analytics.table.date"), dataIndex: "created_at", key: "created_at" },
        { title: t("analytics.table.enemy"), dataIndex: "enemy_name", key: "enemy_name" },
        { title: t("analytics.table.result"), dataIndex: "result", key: "result" },
        { title: t("analytics.wars.own"), dataIndex: "own", key: "own" },
        { title: t("analytics.wars.enemy"), dataIndex: "enemy", key: "enemy" },
        { title: t("analytics.wars.margin"), dataIndex: "margin", key: "margin" },
      ];
    }
    if (analyticsMode === "player") {
      const columns: AnalyticsTableColumn[] = [
        { title: t("analytics.table.war"), dataIndex: "war_name", key: "war_name" },
        { title: t("analytics.table.date"), dataIndex: "created_at", key: "created_at" },
        { title: t("analytics.table.result"), dataIndex: "result", key: "result" },
      ];
      analyticsSelectedUsers.forEach((userId, userIndex) => {
        analyticsSelectedMetrics.forEach((metric, metricIndex) => {
          columns.push({
            title: `${analyticsUserIdToUsername.get(userId) ?? userId} - ${getMetricLabelKey(metric)}`,
            dataIndex: `user${userIndex}_metric${metricIndex}`,
            key: `user${userIndex}_metric${metricIndex}`,
          });
        });
      });
      return columns;
    }
    if (analyticsMode === "rankings") {
      const columns: AnalyticsTableColumn[] = [
        { title: t("analytics.table.rank"), dataIndex: "rank", key: "rank" },
        { title: t("analytics.table.member"), dataIndex: "user_id", key: "user_id" },
        { title: t("analytics.table.wars"), dataIndex: "participation", key: "participation" },
        { title: t("analytics.table.poolWars"), dataIndex: "poolWars", key: "poolWars" },
        { title: t("analytics.table.excused"), dataIndex: "excused", key: "excused" },
        { title: t("analytics.table.attendance"), dataIndex: "attendanceRate", key: "attendanceRate" },
      ];
      if (analyticsSelectedMetrics.length <= 1) {
        columns.push({ title: t("analytics.table.score"), dataIndex: "score", key: "score" });
      } else {
        for (const metric of analyticsSelectedMetrics) {
          columns.push({
            title: getMetricLabelKey(metric),
            dataIndex: `metric_${metric}`,
            key: `metric_${metric}`,
          });
        }
      }
      columns.push({ title: "±σ", dataIndex: "stdDev", key: "stdDev" });
      return columns;
    }
    return [
      { title: t("analytics.table.team"), dataIndex: "team_name", key: "team_name" },
      { title: t("analytics.table.wars"), dataIndex: "wars", key: "wars" },
      { title: t("analytics.table.total"), dataIndex: "total", key: "total" },
      { title: t("analytics.table.average"), dataIndex: "average", key: "average" },
    ];
  }, [analyticsMode, analyticsSelectedMetrics, analyticsSelectedUsers, analyticsUserIdToUsername, getMetricLabelKey, t]);

  // Heatmap ranges: min/max per numeric column for color intensity
  const analyticsTableHeatmapRanges = useMemo(() => {
    const ranges = new Map<string, { min: number; max: number }>();
    const numericKeys = analyticsTableColumns
      .filter((col) => col.key !== "war_name" && col.key !== "created_at" && col.key !== "result" && col.key !== "enemy_name" && col.key !== "rank" && col.key !== "user_id" && col.key !== "team_name")
      .map((col) => col.dataIndex ?? col.key);
    for (const key of numericKeys) {
      let min = Infinity;
      let max = -Infinity;
      for (const row of analyticsTableRows as Array<Record<string, unknown>>) {
        const val = row[key];
        if (typeof val === "number") {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      if (min !== Infinity && max !== -Infinity && max > min) {
        ranges.set(key, { min, max });
      }
    }
    return ranges;
  }, [analyticsTableColumns, analyticsTableRows]);

  return {
    analyticsSelectableUserIds,
    analyticsUserIdToUsername,
    analyticsUserIdToAvatarMediaId,
    analyticsTeamOptions,
    analyticsTimeline,
    analyticsMetricLabel,
    analyticsMetricLabels,
    analyticsRankingRows,
    analyticsRankingRowsByMetric,
    analyticsTeamSeries,
    analyticsTeamSeriesByMetric,
    analyticsPlayerRows,
    analyticsWarSummary,
    analyticsChartOption,
    analyticsRadarOption,
    analyticsTableRows,
    analyticsTableColumns,
    analyticsTableHeatmapRanges,
    getNormalizedMetricValue,
    getNormalizedMetricValueOrNull,
  };
}
