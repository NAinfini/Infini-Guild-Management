import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LATENCY_BAND_COLOR_VAR } from "./AdminSystemSection";

const repoRoot = process.cwd();
const CSS_PATH = resolve(repoRoot, "apps/portal/components/feature/admin/AdminSystemSection.css");

/* Latency rings, bars, and values project one shared band palette into JS and CSS. */
describe("latency band colour parity (AdminSystemSection.tsx <-> AdminSystemSection.css)", () => {
  it("keeps LATENCY_BAND_COLOR_VAR in sync with .health-log-latency-bar--* backgrounds", () => {
    const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const cssValues: Record<string, string> = {};
    for (const rule of css.matchAll(/\.health-log-latency-bar--(\w+)\s*\{\s*background:\s*([^;]+);/g)) {
      const band = rule[1] ?? "";
      const value = rule[2] ?? "";
      cssValues[band] = value.trim();
    }

    expect(cssValues).toEqual(LATENCY_BAND_COLOR_VAR);
  });

  it("keeps LATENCY_BAND_COLOR_VAR in sync with .health-log-latency-value--* text colours", () => {
    const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const cssValues: Record<string, string> = {};
    for (const rule of css.matchAll(/\.health-log-latency-value--(\w+)\s*\{\s*color:\s*([^;]+);/g)) {
      const band = rule[1] ?? "";
      const value = rule[2] ?? "";
      cssValues[band] = value.trim();
    }

    expect(cssValues).toEqual(LATENCY_BAND_COLOR_VAR);
  });
});
