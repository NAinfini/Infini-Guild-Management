// @vitest-environment node
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

  it("draws the category run control at icon size and leaves the touch target to the shared expander", () => {
    const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const runButtonRule = css.match(
      /\.api-cat__actions\s+\.api-cat__run-button\s*\{([^}]+)\}/,
    )?.[1];

    // 可见尺寸走共享控件的 regular 档，44×44 是靶面，由
    // 共享 Button 的 ::before 统一撑开。把靶面令牌当可见尺寸写在
    // 这里，等于每行右边立一个 44px 方块，还把靶面的事实来源复制了一份。
    expect(runButtonRule).not.toMatch(/inline-size|block-size|--control-hit-area/);

    const tsx = readFileSync(
      resolve(repoRoot, "apps/portal/components/feature/admin/AdminApiTestCategory.tsx"),
      "utf8",
    );
    expect(tsx).toMatch(/className="api-cat__run-button"[\s\S]*?size="icon-sm"/);

    const sharedCss = readFileSync(
      resolve(repoRoot, "apps/portal/styles/shadcn.css"),
      "utf8",
    );
    expect(sharedCss).toMatch(/\[data-slot="button"\]::before\s*\{[\s\S]*?inline-size:\s*max\(100%,\s*var\(--control-hit-area\)\)/);
    expect(sharedCss).toMatch(/\[data-slot="button"\]::before\s*\{[\s\S]*?block-size:\s*max\(100%,\s*var\(--control-hit-area\)\)/);
  });
});
