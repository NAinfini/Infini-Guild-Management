// @vitest-environment node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_THEME_ID,
  resolveVisualThemeId,
  VISUAL_ACCESS_SCENE_IDS,
  VISUAL_COLOR_MODES,
  VISUAL_PAGE_SCENE_IDS,
  VISUAL_STATUS_SCENE_IDS,
  VISUAL_THEMES,
  type VisualThemeAsset,
} from "./themes";

type SharpMetadataReader = (path: string) => {
  metadata: () => Promise<{ width?: number; height?: number }>;
};

const sharp = createRequire(import.meta.url)("sharp") as SharpMetadataReader;

function publicAsset(src: string): string {
  return join(process.cwd(), "apps/portal/public", src.replace(/^\//, ""));
}

async function expectShippedAsset(asset: VisualThemeAsset): Promise<void> {
  for (const colorMode of VISUAL_COLOR_MODES) {
    const source = asset.sources[colorMode];
    const path = publicAsset(source.src);
    expect(existsSync(path), `Missing ${source.src}`).toBe(true);
    const metadata = await sharp(path).metadata();
    expect(metadata.width, `Unexpected width for ${source.src}`).toBe(asset.width);
    expect(metadata.height, `Unexpected height for ${source.src}`).toBe(asset.height);
  }
}

describe("visual theme catalog", () => {
  it("rejects an unknown configured theme", () => {
    expect(resolveVisualThemeId(undefined)).toBe(DEFAULT_VISUAL_THEME_ID);
    expect(resolveVisualThemeId("  forged  ")).toBe("forged");
    expect(() => resolveVisualThemeId("unknown")).toThrow(/Unknown VITE_VISUAL_THEME/);
  });

  it("ships every configured asset at its declared dimensions", async () => {
    for (const theme of Object.values(VISUAL_THEMES)) {
      const assets = [
        theme.scenes.landing.desktop,
        theme.scenes.landing.mobile,
        ...VISUAL_ACCESS_SCENE_IDS.flatMap((id) => [theme.scenes.access[id].desktop, theme.scenes.access[id].mobile]),
        ...VISUAL_STATUS_SCENE_IDS.flatMap((id) => [theme.scenes.status[id].desktop, theme.scenes.status[id].mobile]),
        theme.scenes.navigation,
        ...VISUAL_PAGE_SCENE_IDS.map((id) => theme.scenes.routes[id]),
      ];
      for (const asset of assets) await expectShippedAsset(asset);
    }
  });

  it("keeps route and color-mode scenes distinct", () => {
    const theme = VISUAL_THEMES.forged;
    for (const mode of VISUAL_COLOR_MODES) {
      const routes = VISUAL_PAGE_SCENE_IDS.map((id) => theme.scenes.routes[id].sources[mode].src);
      expect(new Set(routes).size).toBe(VISUAL_PAGE_SCENE_IDS.length);
    }
    const assets = [
      theme.scenes.landing.desktop,
      theme.scenes.landing.mobile,
      theme.scenes.navigation,
      ...VISUAL_PAGE_SCENE_IDS.map((id) => theme.scenes.routes[id]),
    ];
    for (const asset of assets) expect(asset.sources.dark.src).not.toBe(asset.sources.light.src);
  });
});
