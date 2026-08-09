import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * motion 的 spring / inertia 只能在**两个**关键帧之间求解，给它三个及以上会直接抛
 * "Only two keyframes currently supported with spring and inertia animations"。
 * 这些图标的 animate 变体是 hover 触发的，抛出来的是未捕获错误——页面不会白屏，
 * 但错误守卫（e2e 的 failOnPageDefects）会把整条用例判成缺陷，而且真正的失败会被
 * 这堆噪音盖住。
 * The guard scans source so coverage does not depend on manually hovering every icon.
 */

const iconsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(iconsDir, "../../../..");
const themeProviderSource = readFileSync(
  resolve(repoRoot, "apps/portal/providers/ThemeProvider.tsx"),
  "utf8",
);

/** 只取 transition 里的 type，避免把变体里别的 `type:` 字段算进来。 */
const SPRING_TRANSITION = /transition:\s*\{[^}]*\btype:\s*["'](spring|inertia)["']/g;

/** `scale: [1, 1.1, 1]` 这种数组关键帧，连同它有几项。 */
const KEYFRAME_ARRAY = /\b[A-Za-z][\w]*:\s*\[([^\]]*)\]/g;

function iconSources(): Array<{ path: string; source: string }> {
  return readdirSync(iconsDir)
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => ({
      path: relative(repoRoot, join(iconsDir, entry)).replace(/\\/g, "/"),
      source: readFileSync(join(iconsDir, entry), "utf8"),
    }));
}

/*
 * 一个变体块：`animate: { ... }`，内部允许一层嵌套（也就是 transition 那一层）。
 * 必须按块扫而不是按行扫——TargetArrowIcon 就是关键帧和 transition 分行写的，
 * 逐行匹配会漏掉它。
 */
const VARIANT_BLOCK = /\b[A-Za-z][\w]*:\s*\{(?:[^{}]|\{[^{}]*\})*\}/g;

/** 同一个变体里既有 spring/inertia 又有超过两帧的数组，就是会抛的那种写法。 */
export function springKeyframeOffenders(path: string, source: string): string[] {
  const offenders: string[] = [];
  const flat = source.replace(/\s+/g, " ");

  for (const [block] of flat.matchAll(VARIANT_BLOCK)) {
    SPRING_TRANSITION.lastIndex = 0;
    if (!SPRING_TRANSITION.test(block)) continue;

    KEYFRAME_ARRAY.lastIndex = 0;
    for (const match of block.matchAll(KEYFRAME_ARRAY)) {
      const frames = (match[1] ?? "").split(",").filter((part) => part.trim().length > 0);
      if (frames.length > 2) {
        offenders.push(`${path} 用 spring/inertia 动 ${frames.length} 个关键帧（${match[0]}）`);
      }
    }
  }
  return offenders;
}

describe("图标动画变体", () => {
  it("由根 MotionConfig 对全部图标入口遵循系统减弱动效偏好", () => {
    expect(themeProviderSource).toContain('import { MotionConfig } from "motion/react"');
    expect(themeProviderSource).toContain('<MotionConfig reducedMotion="user">');

    const uncovered = iconSources()
      .filter(({ source }) => !(
        source.includes('from "motion/react"')
        && source.includes("useParentInteractiveHover")
        && source.includes("onMouseEnter")
        && source.includes("useImperativeHandle")
      ))
      .map(({ path }) => path);

    expect(
      uncovered,
      "每个图标的父级 hover、直接 hover 与程序化入口都必须留在根 MotionConfig 覆盖的 Motion 链路中",
    ).toEqual([]);
  });

  it("不给 spring 超过两个关键帧", () => {
    const offenders = iconSources().flatMap(({ path, source }) => (
      springKeyframeOffenders(path, source)
    ));

    expect(offenders, "改成 ease: \"easeInOut\"，写法见 TextSizeIcon.tsx").toEqual([]);
  });

  it("守卫本身抓得住这种写法", () => {
    const bad = 'animate: { scale: [1, 1.1, 1], transition: { duration: 0.4, type: "spring" } },';
    const good = 'animate: { scale: [1, 1.1, 1], transition: { duration: 0.4, ease: "easeInOut" } },';
    const twoFrames = 'animate: { scale: [1, 1.1], transition: { duration: 0.4, type: "spring" } },';
    /* 关键帧和 transition 分行写的（TargetArrowIcon 就是这样），一样得抓到。 */
    const multiline = [
      "  animate: {",
      "    translateX: [3, -1, 0],",
      '    transition: { duration: 0.5, type: "spring" },',
      "  },",
    ].join("\n");
    /* 相邻的两个变体不能被串成一块：normal 的 spring 配 animate 的三帧不算违规。 */
    const neighbours = [
      '  normal: { scale: 1, transition: { type: "spring" } },',
      '  animate: { scale: [1, 1.1, 1], transition: { ease: "easeInOut" } },',
    ].join("\n");

    expect(springKeyframeOffenders("Fake.tsx", bad)).toHaveLength(1);
    expect(springKeyframeOffenders("Fake.tsx", multiline)).toHaveLength(1);
    expect(springKeyframeOffenders("Fake.tsx", good)).toEqual([]);
    expect(springKeyframeOffenders("Fake.tsx", twoFrames), "两帧的弹簧是合法的").toEqual([]);
    expect(springKeyframeOffenders("Fake.tsx", neighbours), "变体之间不能串味").toEqual([]);
  });
});
