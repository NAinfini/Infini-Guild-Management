import seedGameData from "./seed-data.json";
import { describe, expect, it } from "vitest";
import { gameDataSchema } from "../schemas/equipment-calc";
import { findBestBuild } from "./best-build";
import { calculateGraduationRate, calculateTotal } from "./engine";
import type { Equipment, GameData, Loadout } from "./types";

const gameData: GameData = gameDataSchema.parse(seedGameData);
const HIGH_IMPACT_STAT = "最大鸣金攻击";

function makeEquipment(id: string, stat: string, value: number): Equipment {
  return {
    id,
    name: id,
    slotId: "5",
    isChengyin: false,
    isPurple: false,
    mainStat: { type: stat, value },
    subStats: [],
    dingyinStat: { type: "", value: 0 },
    createdAt: 1,
  };
}

function makeLoadout(classId = gameData.classes[0]): Loadout {
  return {
    id: "loadout",
    name: "Loadout",
    classId,
    xinfaSlots: gameData.xinfaRules[classId]?.default ?? [],
    setId: gameData.defaultSets[classId] ?? "",
    bowType: "precision",
    armoryType: classId.substring(0, 2),
    equippedItems: {},
    earlySeasonBonus: false,
    loanDingyin: false,
    loanDingyinStats: { outerPenetration: 0, elePenetration: 0, specificSkillBonus: 0 },
  };
}

describe("findBestBuild", () => {
  function exhaustiveBest(pool: Equipment[], loadout: Loadout): string | undefined {
    const heads = pool.filter((equipment) => equipment.slotId === "5");
    let best: { id: string; graduationRate: number } | null = null;
    for (const head of heads) {
      const stats = calculateTotal(
        { head },
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
      const graduationRate = calculateGraduationRate(
        stats,
        loadout.classId,
        loadout.xinfaSlots,
        loadout.setId,
        gameData,
        { skipExcelRate: true },
      ).graduationRate;
      if (!best || graduationRate > best.graduationRate) {
        best = { id: head.id, graduationRate };
      }
    }
    return best?.id;
  }

  it("keeps high-impact candidates when pruning large slot pools", () => {
    const loadout = makeLoadout();
    const lowImpact = Array.from({ length: 100 }, (_, index) =>
      makeEquipment(`low-${index}`, "unused test stat", 100000 + index),
    );
    const highImpact = makeEquipment("high-impact", HIGH_IMPACT_STAT, 100);

    const results = findBestBuild({
      pool: [...lowImpact, highImpact],
      loadout,
      lockedSlots: {},
      gameData,
    });

    expect(results.some((result) => result.equippedItems.head === highImpact.id)).toBe(true);
  });

  it("does not use the same equipment id in multiple slots", () => {
    const sharedWeapon = makeEquipment("shared-weapon", HIGH_IMPACT_STAT, 100);
    sharedWeapon.slotId = "1";
    const loadout = makeLoadout();

    const results = findBestBuild({
      pool: [sharedWeapon],
      loadout,
      lockedSlots: {},
      gameData,
    });

    for (const result of results) {
      const ids = Object.values(result.equippedItems);
      expect(ids.filter((id) => id === sharedWeapon.id)).toHaveLength(1);
    }
  });

  it("uses locked slots when a locked item is present", () => {
    const lockedHead = makeEquipment("locked-head", "unused test stat", 1);
    const betterHead = makeEquipment("better-head", HIGH_IMPACT_STAT, 100);
    const loadout = makeLoadout();

    const results = findBestBuild({
      pool: [betterHead, lockedHead],
      loadout,
      lockedSlots: { head: lockedHead.id },
      gameData,
    });

    expect(results[0]?.equippedItems.head).toBe(lockedHead.id);
  });

  it("returns no builds when cancelled before search", () => {
    const head = makeEquipment("head", HIGH_IMPACT_STAT, 100);
    const loadout = makeLoadout();

    const results = findBestBuild({
      pool: [head],
      loadout,
      lockedSlots: {},
      gameData,
      signal: { aborted: true },
    });

    expect(results).toEqual([]);
  });

  it("keeps result ordering stable by graduation rate", () => {
    const weaker = makeEquipment("weaker", HIGH_IMPACT_STAT, 50);
    const stronger = makeEquipment("stronger", HIGH_IMPACT_STAT, 100);
    const loadout = makeLoadout();

    const results = findBestBuild({
      pool: [weaker, stronger],
      loadout,
      lockedSlots: {},
      gameData,
    });

    expect(results.length).toBeGreaterThan(1);
    for (let index = 1; index < results.length; index += 1) {
      expect(results[index - 1].graduationRate).toBeGreaterThanOrEqual(results[index].graduationRate);
    }
  });

  it("matches exhaustive search for the best candidate after slot-pool trimming", () => {
    const loadout = makeLoadout();
    const pool = Array.from({ length: 125 }, (_, index) => {
      const equipment = makeEquipment(`candidate-${index}`, HIGH_IMPACT_STAT, index + 1);
      equipment.subStats = [{ type: HIGH_IMPACT_STAT, value: index % 7 }];
      return equipment;
    });

    const results = findBestBuild({
      pool,
      loadout,
      lockedSlots: {},
      gameData,
      maxCandidatesPerSlot: null,
    });

    expect(results[0]?.equippedItems.head).toBe(exhaustiveBest(pool, loadout));
  });
});
