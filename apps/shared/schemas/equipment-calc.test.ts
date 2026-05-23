import seedGameData from "../calculator/seed-data.json";
import { describe, expect, it } from "vitest";
import { gameDataSchema } from "./equipment-calc";

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
});
