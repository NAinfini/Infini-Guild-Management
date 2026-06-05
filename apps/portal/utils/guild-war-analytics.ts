import { activeGame } from "@guild/shared/games";

export type AnalyticsMetricKey = string;
export type AnalyticsAggregation = "total" | "average" | "best" | "median";

const METRIC_LABEL_MAP: Record<string, string> = Object.fromEntries(
  activeGame.war.memberStats.map((stat) => [stat.key, stat.label.replace(/^guild-war:/, "")]),
);

const LOWER_IS_BETTER_METRICS: Set<string> = new Set(
  [
    ...activeGame.war.memberStats.filter((stat) => stat.lowerIsBetter).map((stat) => stat.key),
    ...(activeGame.war.computedStats?.filter((stat) => stat.lowerIsBetter).map((stat) => stat.key) ?? []),
  ],
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
  const stats = row.stats ?? {};
  const computedDef = activeGame.war.computedStats?.find((computed) => computed.key === metric);
  if (computedDef) {
    const resolved: Record<string, number> = {};
    for (const stat of activeGame.war.memberStats) {
      resolved[stat.key] = stats[stat.key] ?? 0;
    }
    return computedDef.compute(resolved);
  }
  return stats[metric] ?? 0;
}

export function metricValueOrNullFromWarMember(
  row: {
    stats: Record<string, number | null> | null;
  },
  metric: AnalyticsMetricKey,
): number | null {
  const computedDef = activeGame.war.computedStats?.find((computed) => computed.key === metric);
  if (computedDef) {
    const stats = row.stats ?? {};
    const hasAny = activeGame.war.memberStats.some((stat) => stats[stat.key] !== null && stats[stat.key] !== undefined);
    if (!hasAny) return null;
    return metricValueFromWarMember(row, metric);
  }
  const value = row.stats?.[metric];
  return value === null || value === undefined ? null : value;
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
    if (LOWER_IS_BETTER_METRICS.has(metric)) {
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
