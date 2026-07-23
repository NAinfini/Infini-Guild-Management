import seedGameData from "../calculator/seed-data.json";
import { describe, expect, it } from "vitest";
import { gameDataSchema } from "./equipment-calc";

const EXPECTED_ROTATION_VERSIONS = {
  "牵丝玉": "牵丝玉110阶竞速轴属性毕业率进阶计算器1.0",
  "牵丝翊": "牵丝翊110阶竞速轴属性毕业率进阶计算器1.0",
  "牵丝霖": "牵丝霖105阶竞速轴属性毕业率进阶计算器0.7",
  "破竹尘": "破竹尘110阶竞速轴属性毕业率进阶计算器1.0",
  "破竹风": "破竹风110阶竞速轴属性毕业率进阶计算器1.0",
  "破竹鸢": "破竹鸢105阶竞速轴属性毕业率进阶计算器1.2",
  "裂石威": "裂石威110阶竞速轴属性毕业率进阶计算器1.0",
  "裂石钧": "裂石钧110阶竞速轴属性毕业率进阶计算器1.13",
  "鸣金影": "鸣金影110阶竞速轴属性毕业率进阶计算器1.0",
  "鸣金虹": "鸣金虹110阶竞速轴属性毕业率进阶计算器1.0",
} as const;

describe("equipment calculator game data schema", () => {
  it("accepts seed data with executable rotation skill data for every class", () => {
    const result = gameDataSchema.safeParse(seedGameData);

    expect(result.success).toBe(true);
    if (result.success) {
      for (const classId of result.data.classes) {
        const rotationConfig = result.data.rotations[classId];
        expect(rotationConfig?.rotation.length, `${classId} rotation`).toBeGreaterThan(0);
        expect(Object.keys(rotationConfig?.skillDatabase ?? {}).length, `${classId} skill database`).toBeGreaterThan(0);
        const executableEntries = (rotationConfig?.rotation ?? []).filter((entry) => rotationConfig?.skillDatabase[entry.name]);
        expect(executableEntries.length, `${classId} executable rotation entries`).toBeGreaterThan(0);
      }
    }
  });

  it("uses the current calculator workbook versions for bundled rotation data", () => {
    const result = gameDataSchema.parse(seedGameData);

    for (const [classId, version] of Object.entries(EXPECTED_ROTATION_VERSIONS)) {
      expect(result.rotations[classId]?.version).toBe(version);
    }
  });
});
