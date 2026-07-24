import type { Equipment, Loadout, GameData, BuildResult, EquippedSlot } from "./types";
import { calculateTotal, calculateGraduationRate } from "./engine";

const MAX_RESULTS = 3;

export interface BestBuildConfig {
  pool: Equipment[];
  loadout: Loadout;
  lockedSlots: Partial<Record<EquippedSlot, string>>;
  gameData: GameData;
  maxCandidatesPerSlot?: number | null;
  onProgress?: (percent: number) => void;
  signal?: { aborted: boolean };
}

type CandidateOption = {
  equipment: Equipment | null;
  score: number;
};

export function findBestBuild(config: BestBuildConfig): BuildResult[] {
  const { pool, loadout, lockedSlots, gameData, onProgress, signal } = config;
  const maxCandidatesPerSlot = config.maxCandidatesPerSlot ?? null;
  const classId = loadout.classId;
  const rotationConfig = gameData.rotations[classId];
  if (!rotationConfig) return [];

  const slotCandidates: Record<string, CandidateOption[]> = {};
  for (const equip of pool) {
    if (equip.availableClasses?.length && !equip.availableClasses.includes(classId)) continue;
    const slot = equip.slotId;
    if (!slotCandidates[slot]) slotCandidates[slot] = [];
    slotCandidates[slot].push({
      equipment: equip,
      score: candidateScore(equip, slot, loadout, gameData),
    });
  }

  for (const slot of Object.keys(slotCandidates)) {
    slotCandidates[slot]!.sort((a, b) => b.score - a.score);
    if (typeof maxCandidatesPerSlot === "number" && maxCandidatesPerSlot > 0) {
      slotCandidates[slot] = slotCandidates[slot]!.slice(0, maxCandidatesPerSlot);
    }
  }

  const equippedSlots: EquippedSlot[] = ["weapon1", "weapon2", "head", "chest", "ring", "pendant", "legs", "hands"];
  const slotOptions: CandidateOption[][] = equippedSlots.map((slot) => {
    if (lockedSlots[slot]) {
      const locked = pool.find((e) => e.id === lockedSlots[slot]);
      return locked ? [{ equipment: locked, score: candidateScore(locked, locked.slotId, loadout, gameData) }] : [{ equipment: null, score: 0 }];
    }
    const slotId = equippedSlotToSlotId(slot);
    return slotCandidates[slotId] ?? [{ equipment: null, score: 0 }];
  });
  const topBuilds: BuildResult[] = [];
  const totalCombinations = slotOptions.reduce((a, b) => a * Math.max(1, b.length), 1);
  let checked = 0;
  let lastProgress = 0;

  const current: (Equipment | null)[] = new Array(equippedSlots.length).fill(null);

  function search(depth: number): void {
    if (signal?.aborted) return;
    if (depth === equippedSlots.length) {
      checked++;
      if (onProgress && totalCombinations > 0) {
        const pct = Math.floor((checked / totalCombinations) * 100);
        if (pct > lastProgress) { lastProgress = pct; onProgress(pct); }
      }

      const items: Record<string, Equipment | undefined> = {};
      for (let i = 0; i < equippedSlots.length; i++) {
        const e = current[i];
        items[equippedSlots[i]!] = e ?? undefined;
      }

      const stats = calculateTotal(
        items, classId, loadout.bowType, loadout.xinfaSlots,
        loadout.setId, loadout.earlySeasonBonus, loadout.loanDingyin,
        loadout.loanDingyinStats, loadout.armoryType,
        gameData,
      );
      const result_calc = calculateGraduationRate(stats, classId, loadout.xinfaSlots, loadout.setId, gameData, { skipExcelRate: true });
      const graduationRate = result_calc.graduationRate;
      const dps = result_calc.expectedDps;

      const result: BuildResult = {
        equippedItems: {},
        graduationRate,
        dps,
      };
      for (let i = 0; i < equippedSlots.length; i++) {
        if (current[i]) {
          (result.equippedItems as Record<string, string>)[equippedSlots[i]!] = current[i]!.id;
        }
      }

      insertSorted(topBuilds, result, MAX_RESULTS);
      return;
    }

    for (const option of slotOptions[depth]!) {
      const equipment = option.equipment;
      if (equipment && current.some((item) => item?.id === equipment.id)) {
        continue;
      }
      current[depth] = equipment;
      search(depth + 1);
      current[depth] = null;
      if (signal?.aborted) return;
    }
  }

  search(0);
  return topBuilds;
}

function insertSorted(arr: BuildResult[], item: BuildResult, maxSize: number): void {
  let i = arr.findIndex((b) => item.graduationRate > b.graduationRate);
  if (i === -1) i = arr.length;
  if (i >= maxSize) return;
  arr.splice(i, 0, item);
  if (arr.length > maxSize) arr.pop();
}

function candidateScore(equip: Equipment, slotId: string, loadout: Loadout, gameData: GameData): number {
  const slot = slotIdToEquippedSlot(slotId);
  if (!slot) return 0;
  const stats = calculateTotal(
    { [slot]: equip },
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
  return calculateGraduationRate(stats, loadout.classId, loadout.xinfaSlots, loadout.setId, gameData, { skipExcelRate: true }).graduationRate;
}

function equippedSlotToSlotId(slot: EquippedSlot): string {
  switch (slot) {
    case "weapon1": case "weapon2": return "1";
    case "ring": return "3";
    case "pendant": return "4";
    case "head": return "5";
    case "chest": return "6";
    case "legs": return "7";
    case "hands": return "8";
  }
}

function slotIdToEquippedSlot(slotId: string): EquippedSlot | null {
  switch (slotId) {
    case "1": return "weapon1";
    case "3": return "ring";
    case "4": return "pendant";
    case "5": return "head";
    case "6": return "chest";
    case "7": return "legs";
    case "8": return "hands";
    default: return null;
  }
}
