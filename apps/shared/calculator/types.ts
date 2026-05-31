import type { z } from "zod";
import type { equipmentSchema, loadoutSchema, gameDataSchema } from "../schemas/equipment-calc";

export type Equipment = z.infer<typeof equipmentSchema>;

export type Loadout = z.infer<typeof loadoutSchema>;

export type LoanDingyinStats = Loadout["loanDingyinStats"];

export type EquippedSlot = keyof Loadout["equippedItems"];

export type ClassRotationConfig = GameData["rotations"][string];

export type GameData = z.infer<typeof gameDataSchema>;

export interface StatSheet {
  [statName: string]: number;
}

export interface CappedStats {
  actualPrecision: number;
  actualCrit: number;
  actualIntent: number;
  precisionOverflow: number;
  critOverflow: number;
  intentOverflow: number;
}

export interface RateBreakdown {
  totalRate: number;
  excelRate: number;
  perSlotRates: Record<string, number>;
  perStatContributions: Record<string, number>;
  baselineDps: number;
  playerDps: number;
}

export interface BuildResult {
  equippedItems: Partial<Record<EquippedSlot, string>>;
  graduationRate: number;
  dps: number;
}

export interface GameDataVersion {
  id: number;
  version: string;
  uploaded_by: number;
  created_at: string;
}
