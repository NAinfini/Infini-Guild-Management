import type { CappedStats, StatSheet } from "./types";

export function capDirectCrit(rate: number): number {
  return Math.min(rate, 20);
}

export function capDirectIntent(rate: number): number {
  return Math.min(rate, 10);
}

export function capRates(stats: StatSheet): CappedStats {
  return {
    actualPrecision: stats["实际精准率"] ?? 0,
    actualCrit: stats["实际会心率"] ?? 0,
    actualIntent: stats["实际会意率"] ?? 0,
    precisionOverflow: stats["精准率溢出"] ?? 0,
    critOverflow: stats["会心率溢出"] ?? 0,
    intentOverflow: stats["会意率溢出"] ?? 0,
  };
}
