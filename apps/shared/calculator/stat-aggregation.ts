import type { StatSheet } from "./types";

export function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function addStat(sheet: StatSheet, statType: string, value: number): void {
  if (!statType || value === 0) return;
  sheet[statType] = (sheet[statType] ?? 0) + value;
}
