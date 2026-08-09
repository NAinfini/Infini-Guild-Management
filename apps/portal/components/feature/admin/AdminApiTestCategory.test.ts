import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRESS_STATE_COLOR_VAR } from "./AdminApiTestCategory";

const repoRoot = process.cwd();
const CSS_PATH = resolve(repoRoot, "apps/portal/components/feature/admin/AdminApiTest.css");

/* RingProgress needs JS literals while progress bars use CSS classes; keep both projections equal. */
describe("progress state colour parity (AdminApiTestCategory.tsx <-> AdminApiTest.css)", () => {
  it("keeps PROGRESS_STATE_COLOR_VAR in sync with .api-cat__progress-fill--* backgrounds", () => {
    const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const cssValues: Record<string, string> = {};
    for (const rule of css.matchAll(/\.api-cat__progress-fill--(\w+)\s*\{\s*background:\s*([^;]+);/g)) {
      const state = rule[1] ?? "";
      const value = rule[2] ?? "";
      cssValues[state] = value.trim();
    }

    expect(cssValues).toEqual(PROGRESS_STATE_COLOR_VAR);
  });

  it("keeps the category run control at a real 44px touch target", () => {
    const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const runButtonRule = css.match(
      /\.api-cat__actions\s+\.api-cat__run-button\s*\{([^}]+)\}/,
    )?.[1];

    expect(runButtonRule).toMatch(/width:\s*44px/);
    expect(runButtonRule).toMatch(/height:\s*44px/);
  });
});
