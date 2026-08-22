/** Shared latency bands for every system-status visualization. */
export type LatencyBand = "good" | "warn" | "bad";

export const LATENCY_WARN_THRESHOLD_MS = 200;

export const LATENCY_BAD_THRESHOLD_MS = 400;

export function latencyBand(ms: number): LatencyBand {
  if (ms < LATENCY_WARN_THRESHOLD_MS) return "good";
  if (ms < LATENCY_BAD_THRESHOLD_MS) return "warn";
  return "bad";
}
