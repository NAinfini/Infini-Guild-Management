import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LATENCY_BAND_COLOR_VAR } from "./AdminSystemSection";

const repoRoot = process.cwd();
const CSS_PATH = resolve(repoRoot, "apps/portal/components/feature/admin/AdminSystemSection.css");

/* final-review.md A-1/M-1（M3）：LATENCY_BAND_COLOR_VAR（本文件）在
 * AdminSystemSection.css 里有两处同义投影——.health-log-latency-bar--*
 * 的 background 与 .health-log-latency-value--* 的 color——外加延迟环的
 * RingProgress color prop 直接吃这个常量的字面 var() 字符串。三处共用
 * 同一组 token，理论上不该分叉，但没有任何东西钉住这个一致性：只钉住
 * 其中一个投影、放过另一个，等于把"三个事实来源"减成"两个半"，剩下那半
 * 边漂移时守卫不会响。两条断言把 bar/value 两个投影都钉死。CSS 当纯文本读
 * （vitest 里普通 CSS import 只是 stub，读不到规则内容）。 */
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
