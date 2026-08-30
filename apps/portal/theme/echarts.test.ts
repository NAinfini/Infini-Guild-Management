import { buildEChartsTheme } from "./echarts";
import { describe, expect, it } from "vitest";

function rootWith(tokens: Record<string, string>): HTMLElement {
  const root = document.createElement("div");
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  document.body.appendChild(root);
  return root;
}

const tokens = {
  "--text-primary": "rgb(20, 20, 24)",
  "--text-muted": "rgb(120, 118, 112)",
  "--border-subtle": "rgb(220, 218, 212)",
  "--surface-overlay": "rgb(255, 255, 255)",
  "--font-body": "Saira, sans-serif",
  "--series-accent": "rgb(15, 110, 86)",
  "--series-1": "rgb(15, 110, 86)",
  "--series-2": "rgb(90, 60, 200)",
  "--series-3": "rgb(200, 110, 20)",
  "--series-4": "rgb(50, 80, 210)",
};

describe("buildEChartsTheme", () => {
  it("derives chart text, surfaces, and axes from live theme tokens", () => {
    const theme = buildEChartsTheme("light", rootWith(tokens));

    expect(theme.textStyle).toEqual({ color: tokens["--text-primary"], fontFamily: tokens["--font-body"] });
    expect(theme.legend.textStyle.color).toBe(tokens["--text-muted"]);
    expect(theme.tooltip.backgroundColor).toBe(tokens["--surface-overlay"]);
    expect(theme.categoryAxis.axisLine.lineStyle.color).toBe(tokens["--border-subtle"]);
  });

  it("removes a duplicate accent, retains a changed accent, and supports dark radar charts", () => {
    const light = buildEChartsTheme("light", rootWith(tokens));
    expect(light.color).toEqual([
      tokens["--series-accent"],
      tokens["--series-2"],
      tokens["--series-3"],
      tokens["--series-4"],
    ]);
    for (const layer of light.radar.splitArea.areaStyle.color) {
      expect(layer).toContain(tokens["--text-primary"]);
    }

    const dark = buildEChartsTheme("dark", rootWith({ ...tokens, "--series-accent": "rgb(156, 140, 245)" }));
    expect(dark.darkMode).toBe(true);
    expect(dark.color[0]).toBe("rgb(156, 140, 245)");
    expect(dark.color).toHaveLength(5);
  });
});
