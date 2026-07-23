import { DEFAULT_FEATURE_FLAGS } from "@guild/shared";
import { describe, expect, it } from "vitest";
import { areApiFeaturesEnabled, requiredFeaturesForApiPath } from "./feature-gate";

describe("feature gate", () => {
  it("maps feature API roots and nested routes", () => {
    expect(requiredFeaturesForApiPath("/api/events")).toEqual(["events"]);
    expect(requiredFeaturesForApiPath("/api/events/evt-1/images")).toEqual(["events"]);
    expect(requiredFeaturesForApiPath("/api/game-data/latest")).toEqual(["tools", "equipmentCalc"]);
    expect(requiredFeaturesForApiPath("/api/site-config")).toEqual([]);
  });

  it("blocks disabled feature APIs, including equipment calculator parent dependency", () => {
    expect(areApiFeaturesEnabled("/api/wiki/articles", {
      ...DEFAULT_FEATURE_FLAGS,
      wiki: false,
    })).toBe(false);
    expect(areApiFeaturesEnabled("/api/game-data/latest", {
      ...DEFAULT_FEATURE_FLAGS,
      tools: false,
      equipmentCalc: true,
    })).toBe(false);
    expect(areApiFeaturesEnabled("/api/game-data/latest", DEFAULT_FEATURE_FLAGS)).toBe(true);
  });
});
