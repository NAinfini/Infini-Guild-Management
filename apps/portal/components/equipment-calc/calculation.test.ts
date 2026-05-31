// @vitest-environment jsdom
import seedGameData from "@guild/shared/calculator/seed-data.json";
import { describe, expect, it } from "vitest";
import { gameDataSchema } from "@guild/shared/schemas/equipment-calc";
import { calculateGraduationRate, calculateTotal } from "@guild/shared/calculator/engine";
import type { Equipment, GameData, Loadout } from "@guild/shared/calculator/types";
import {
  buildEquippedMap,
  calculateManualEntryResult,
  calculateRateWithStatAdjustment,
} from "./calculation";

const gameData: GameData = gameDataSchema.parse(seedGameData);

function makeLoadout(): Loadout {
  const classId = gameData.classes[0];
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

function makeEquipment(id: string): Equipment {
  return {
    id,
    name: id,
    slotId: "1",
    isChengyin: false,
    isPurple: false,
    mainStat: { type: "最大外功攻击", value: 10 },
    subStats: [],
    dingyinStat: { type: "", value: 0 },
    createdAt: 1,
  };
}

describe("equipment calculator calculation helpers", () => {
  it("removes duplicate equipment ids when overriding a slot", () => {
    const item = makeEquipment("weapon");
    const loadout = { ...makeLoadout(), equippedItems: { weapon1: item.id } };

    const equipped = buildEquippedMap(loadout, [item], { slot: "weapon2", equipment: item });

    expect(equipped.weapon1).toBeUndefined();
    expect(equipped.weapon2?.id).toBe(item.id);
  });

  it("applies stat priority adjustments before final stat conversions", () => {
    const loadout = makeLoadout();
    const adjustedRate = calculateRateWithStatAdjustment({}, loadout, "敏", 20, gameData);
    const staleFinalizedRate = calculateGraduationRate(
      { ...gameData.baseStats, "敏": (gameData.baseStats["敏"] ?? 0) + 20 },
      loadout.classId,
      loadout.xinfaSlots,
      loadout.setId,
      gameData,
    ).graduationRate;

    expect(adjustedRate).not.toBe(staleFinalizedRate);
  });

  it("manual entry runs entered stats through the same total calculation path", () => {
    const loadout = makeLoadout();
    const result = calculateManualEntryResult({ "敏": 20 }, loadout, gameData);
    const expectedStats = calculateTotal(
      {
        manual: {
          id: "manual-min",
          name: "manual",
          slotId: "__manual",
          isChengyin: false,
          isPurple: false,
          mainStat: { type: "敏", value: 20 },
          subStats: [],
          dingyinStat: { type: "", value: 0 },
          createdAt: 0,
        },
      },
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

    expect(result.graduationRate).toBe(
      calculateGraduationRate(expectedStats, loadout.classId, loadout.xinfaSlots, loadout.setId, gameData).graduationRate,
    );
  });
});
