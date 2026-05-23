import { calculateGraduationRate, calculateTotal } from "@guild/shared/calculator/engine";
import type { Equipment, EquippedSlot, GameData, Loadout } from "@guild/shared/calculator/types";

type Override = {
  slot: EquippedSlot;
  equipment: Equipment;
};

type RateResult = ReturnType<typeof calculateGraduationRate>;

export function buildEquippedMap(
  loadout: Loadout,
  pool: Equipment[],
  override?: Override,
): Record<string, Equipment | undefined> {
  const poolMap = new Map(pool.map((equipment) => [equipment.id, equipment]));
  const equipped: Record<string, Equipment | undefined> = {};

  for (const [slot, id] of Object.entries(loadout.equippedItems)) {
    if (!id) continue;
    if (override?.equipment.id === id && slot !== override.slot) continue;
    equipped[slot] = poolMap.get(id);
  }

  if (override) {
    equipped[override.slot] = override.equipment;
  }

  return equipped;
}

export function calculateLoadoutResult(
  equipped: Record<string, Equipment | undefined>,
  loadout: Loadout,
  gameData: GameData,
): RateResult {
  const stats = calculateTotal(
    equipped,
    loadout.classId,
    loadout.bowType,
    loadout.xinfaSlots,
    loadout.setId,
    loadout.earlySeasonBonus,
    loadout.loanDingyin,
    loadout.loanDingyinStats,
    loadout.armoryType,
    gameData,
  );

  return calculateGraduationRate(stats, loadout.classId, loadout.xinfaSlots, loadout.setId, gameData);
}

function makeManualEquipment(statValues: Record<string, number>): Equipment[] {
  return Object.entries(statValues)
    .filter(([, value]) => value !== 0)
    .map(([stat, value], index) => ({
      id: `manual-${index}`,
      name: "manual",
      slotId: "__manual",
      isChengyin: false,
      isPurple: false,
      mainStat: { type: stat, value },
      subStats: [],
      dingyinStat: { type: "", value: 0 },
      createdAt: 0,
    }));
}

export function calculateRateWithStatAdjustment(
  equipped: Record<string, Equipment | undefined>,
  loadout: Loadout,
  stat: string,
  delta: number,
  gameData: GameData,
): number {
  const adjusted = { ...equipped };
  adjusted.__statAdjustment = makeManualEquipment({ [stat]: delta })[0];
  return calculateLoadoutResult(adjusted, loadout, gameData).graduationRate;
}

export function calculateManualEntryResult(
  statValues: Record<string, number>,
  loadout: Loadout,
  gameData: GameData,
): RateResult {
  const equipped: Record<string, Equipment | undefined> = {};
  for (const item of makeManualEquipment(statValues)) {
    equipped[item.id] = item;
  }
  return calculateLoadoutResult(equipped, loadout, gameData);
}
