// @vitest-environment node
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_THEME_ID,
  resolveVisualThemeId,
  VISUAL_PAGE_SCENE_IDS,
  VISUAL_THEME_IDS,
  VISUAL_THEMES,
  type VisualThemeAsset,
} from "./themes";

function resolvePublicAsset(src: string): string {
  return join(process.cwd(), "apps/portal/public", src.replace(/^\//, ""));
}

function expectShippedAsset(asset: VisualThemeAsset): void {
  const absolutePath = resolvePublicAsset(asset.src);
  expect(existsSync(absolutePath), `Missing ${asset.src}`).toBe(true);
  expect(statSync(absolutePath).size, `Unexpected byte size for ${asset.src}`).toBe(asset.bytes);
  expect(asset.width).toBeGreaterThan(0);
  expect(asset.height).toBeGreaterThan(0);
}

describe("visual theme catalog", () => {
  it("defaults to the forged theme and rejects unknown configuration", () => {
    expect(resolveVisualThemeId(undefined)).toBe(DEFAULT_VISUAL_THEME_ID);
    expect(resolveVisualThemeId("  forged  ")).toBe("forged");
    expect(() => resolveVisualThemeId("unknown")).toThrow(/Unknown VITE_VISUAL_THEME/);
  });

  it("defines every source-owned theme exactly once", () => {
    expect(Object.keys(VISUAL_THEMES).sort()).toEqual([...VISUAL_THEME_IDS].sort());
    for (const id of VISUAL_THEME_IDS) {
      expect(VISUAL_THEMES[id].id).toBe(id);
    }
  });

  it("ships audited public and route art for the complete route registry", () => {
    for (const id of VISUAL_THEME_IDS) {
      const theme = VISUAL_THEMES[id];
      expect(Object.keys(theme.scenes.routes).sort()).toEqual([...VISUAL_PAGE_SCENE_IDS].sort());

      for (const asset of [
        theme.scenes.landing,
        theme.scenes.access.desktop,
        theme.scenes.access.mobile,
        theme.scenes.status,
        theme.scenes.navigation,
        ...VISUAL_PAGE_SCENE_IDS.map((sceneId) => theme.scenes.routes[sceneId]),
      ]) {
        expectShippedAsset(asset);
      }

      const markPath = resolvePublicAsset(theme.mark.src);
      expect(existsSync(markPath), `Missing ${theme.mark.src}`).toBe(true);
      expect(statSync(markPath).size).toBeGreaterThan(0);
    }
  });

  it("gives each route a distinct scene and exposes no generated identity API", () => {
    const theme = VISUAL_THEMES.forged;
    const routeSources = VISUAL_PAGE_SCENE_IDS.map((sceneId) => theme.scenes.routes[sceneId].src);

    expect(new Set(routeSources).size).toBe(VISUAL_PAGE_SCENE_IDS.length);
    expect(theme).not.toHaveProperty("subjects");
    expect(theme).not.toHaveProperty("objects");
    expect(theme).not.toHaveProperty("characters");
  });
});
