import type { AnalyticsAggregation, AnalyticsMetricKey } from "../types/guild-war";
import { DEFAULT_GAME_RULES } from "@guild/shared";
import {
  getGuildWarMemberStatLabel,
  getGuildWarMetricValue,
  getGuildWarMetricValueOrNull,
  getGuildWarTeamStatLabel,
} from "./game-rules";

export type { AnalyticsAggregation, AnalyticsMetricKey } from "../types/guild-war";

export function getTeamObjectiveLabelKey(objective: string): string {
  return getGuildWarTeamStatLabel(objective);
}

export function getMetricLabelKey(metric: AnalyticsMetricKey): string {
  return getGuildWarMemberStatLabel(metric);
}

export function metricValueFromWarMember(
  row: {
    stats: Record<string, number | null> | null;
  },
  metric: AnalyticsMetricKey,
): number {
  return getGuildWarMetricValue(row.stats, metric);
}

export function metricValueOrNullFromWarMember(
  row: {
    stats: Record<string, number | null> | null;
  },
  metric: AnalyticsMetricKey,
): number | null {
  return getGuildWarMetricValueOrNull(row.stats, metric);
}

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
    const lowerIsBetter = DEFAULT_GAME_RULES.guild_war.member_stats
      .find((definition) => definition.key === metric)?.lower_is_better ?? false;
    if (lowerIsBetter) {
      timeNormalized /= modifier;
    } else {
      timeNormalized *= modifier;
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

export function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

export function aggregateValues(values: number[], aggregation: AnalyticsAggregation): number {
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
      return Number(((sorted[middle - 1]! + sorted[middle]!) / 2).toFixed(2));
    }
    return sorted[middle] ?? 0;
  }
  if (aggregation === "average") {
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }
  return values.reduce((sum, value) => sum + value, 0);
}
