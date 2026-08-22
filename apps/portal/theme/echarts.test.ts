import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEChartsTheme } from "./echarts";

/**
 * 建一个把 token 写成内联样式的根节点。jsdom 不加载真实样式表，
 * 但 getComputedStyle 会如实回读内联自定义属性，足以验证「哪个 token 去了哪里」。
 */
function rootWith(tokens: Record<string, string>): HTMLElement {
  const root = document.createElement("div");
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  document.body.appendChild(root);
  return root;
}

const BASE_TOKENS = {
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
  it("takes every colour from the live token layer instead of a private palette", () => {
    const theme = buildEChartsTheme("light", rootWith(BASE_TOKENS));

    expect(theme.textStyle).toEqual({
      color: "rgb(20, 20, 24)",
      fontFamily: "Saira, sans-serif",
    });
    expect(theme.legend.textStyle.color).toBe("rgb(120, 118, 112)");
    expect(theme.tooltip.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(theme.tooltip.borderColor).toBe("rgb(220, 218, 212)");
    expect(theme.categoryAxis.axisLine.lineStyle.color).toBe("rgb(220, 218, 212)");
    expect(theme.categoryAxis.axisLabel.color).toBe("rgb(120, 118, 112)");
    expect(theme.backgroundColor).toBe("transparent");
  });

  /* 主色落在分类序某一族上时（teal 主色 + --series-1 同为青瓷），
     两条数据会拿到同一个颜色——比少一个颜色更糟。 */
  it("drops the duplicate when the accent shares a hue family with a series slot", () => {
    const theme = buildEChartsTheme("light", rootWith(BASE_TOKENS));

    expect(theme.color).toEqual([
      "rgb(15, 110, 86)",
      "rgb(90, 60, 200)",
      "rgb(200, 110, 20)",
      "rgb(50, 80, 210)",
    ]);
  });

  it("leads the series with the accent so a single-series chart carries the site colour", () => {
    const theme = buildEChartsTheme("dark", rootWith({
      ...BASE_TOKENS,
      "--series-accent": "rgb(156, 140, 245)",
    }));

    expect(theme.color[0]).toBe("rgb(156, 140, 245)");
    expect(theme.color).toHaveLength(5);
    expect(theme.darkMode).toBe(true);
  });

  /* 雷达图的环形分区原本是三档写死的白色叠加，压在浅色模式的白卡片上等于没画。 */
  it("derives radar split areas from the text colour so they survive both themes", () => {
    const theme = buildEChartsTheme("light", rootWith(BASE_TOKENS));

    for (const layer of theme.radar.splitArea.areaStyle.color) {
      expect(layer).toContain("rgb(20, 20, 24)");
    }
  });

  /* 这个模块曾经自带一套金棕色板和自己的 Inter 字体栈，和站内任何颜色都对不上，
     也不随主色变化。断言钉住「颜色只能来自 token」这件事，别让它长回来。 */
  it("holds no colour literal of its own", () => {
    const source = readFileSync(resolve(__dirname, "echarts.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\s*\(/);
    expect(source).not.toMatch(/\bInter\b/);
  });
});
