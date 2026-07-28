import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRESS_STATE_COLOR_VAR } from "./AdminApiTestCategory";

const repoRoot = process.cwd();
const CSS_PATH = resolve(repoRoot, "apps/portal/components/feature/admin/AdminApiTest.css");

/* final-review.md A-1/M-1（M3）：PROGRESS_STATE_COLOR_VAR（本文件）与
 * AdminApiTest.css 的 .api-cat__progress-fill--* 各写一份同义的
 * state → token 表——RingProgress 的 color prop 只吃字面字符串、不认
 * className，只能靠 JS 侧常量；进度条的 background 走 class，只能靠 CSS
 * 侧规则。两侧当前逐值一致，但没有任何东西钉住这个一致性，谁改了一边都
 * 不会有报错。CSS 当纯文本读（vitest 里普通 CSS import 只是 stub，读不到
 * 规则内容）。 */
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
