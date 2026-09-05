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
  VISUAL_STATUS_SCENE_IDS,
  VISUAL_WORKSPACE_SCENE_IDS,
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
        ...VISUAL_WORKSPACE_SCENE_IDS.flatMap((id) => [theme.scenes.workspace[id].desktop, theme.scenes.workspace[id].mobile]),
        theme.scenes.landing.desktop,
        theme.scenes.landing.mobile,
        ...VISUAL_ACCESS_SCENE_IDS.flatMap((id) => [theme.scenes.access[id].desktop, theme.scenes.access[id].mobile]),
        ...VISUAL_STATUS_SCENE_IDS.flatMap((id) => [theme.scenes.status[id].desktop, theme.scenes.status[id].mobile]),
      ];
      for (const asset of assets) await expectShippedAsset(asset);
    }
  });

  it("keeps every color-mode scene distinct", () => {
    const theme = VISUAL_THEMES.forged;
    const assets = [
      ...VISUAL_WORKSPACE_SCENE_IDS.flatMap((id) => [theme.scenes.workspace[id].desktop, theme.scenes.workspace[id].mobile]),
      theme.scenes.landing.desktop,
      theme.scenes.landing.mobile,
      ...VISUAL_ACCESS_SCENE_IDS.flatMap((id) => [theme.scenes.access[id].desktop, theme.scenes.access[id].mobile]),
      ...VISUAL_STATUS_SCENE_IDS.flatMap((id) => [theme.scenes.status[id].desktop, theme.scenes.status[id].mobile]),
    ];
    for (const asset of assets) expect(asset.sources.dark.src).not.toBe(asset.sources.light.src);
  });
});
