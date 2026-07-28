import { activeGame } from "@guild/shared/games";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TYPE_COLORS, UNKNOWN_EVENT_TYPE_COLOR } from "./event-colors";

const repoRoot = process.cwd();
const EVENT_CARDS_CSS = resolve(repoRoot, "apps/portal/components/feature/events/EventCardsView.css");

describe("event colours", () => {
  /* 这条断言此前叫 "covers every configured event type"，读起来像在保护一个
   * 真实耦合，但 EVENT_TYPE_COLORS 就是由 activeGame.eventTypes 用
   * Object.fromEntries 造的，Object.keys() 必然等于那些 id ——唯一能让它
   * 变红的情况是配置里出现重复 id（Object.fromEntries 会静默丢弃前一个）。
   * 改成诚实命名，真正有价值的 CSS↔配置一致性断言见下面那条
   * （final-review.md M4，回应 I3）。 */
  it("has no duplicate event type ids in the game config", () => {
    const ids = activeGame.eventTypes.map((et) => et.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* 这条断言是本模块存在的理由。兜底色与任一已登记类型撞色时，未知类型
   * （数据异常）会渲染成合法类型的样子 —— 静默伪装，看不出来。此前那张表被
   * 抄了三份，兜底分叉成 gray / gray / lime，其中 gray 正好撞上 other。
   * 收敛成一份之后，撞色不再有横向对照能发现，只能靠这条断言。 */
  it("uses a fallback colour that no configured type already claims", () => {
    const claimed = Object.values(EVENT_TYPE_COLORS);
    expect(claimed).not.toContain(UNKNOWN_EVENT_TYPE_COLOR);
  });

  /* final-review.md I3：EventCardsView.css 里 --event-card-accent 兜底是
   * 死代码的结论，前提是六条 :has() 规则覆盖了 EVENT_TYPE_COLORS 的全部
   * 分支 ∪ {other}。CSS 侧类名硬编码、配置侧数据驱动，两者原本没有守卫
   * 绑定：往 yan-yun.ts 加一个事件类型，getTypeGradientClass 会产出
   * event-card__header--<新id>，六条规则一条都不匹配，
   * --event-card-accent 未定义，整条 linear-gradient IACVT，左侧色条
   * 静默消失、无任何报错。这条断言把"覆盖"从注释里的主张变成可执行的
   * 集合相等，CSS 当纯文本读（vitest 未配置 test.css，正常 CSS import
   * 在测试里只是 stub，读不到规则内容）。 */
  it("defines --event-card-accent for exactly the configured event types plus the unknown-type fallback", () => {
    const css = readFileSync(EVENT_CARDS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const accentTypeIds = new Set<string>();
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1] ?? "";
      const body = rule[2] ?? "";
      if (!body.includes("--event-card-accent:")) continue;
      for (const idMatch of selector.matchAll(/event-card__header--([\w-]+)/g)) {
        accentTypeIds.add(idMatch[1] ?? "");
      }
    }

    const expectedTypeIds = new Set([...activeGame.eventTypes.map((et) => et.id), "other"]);
    expect(accentTypeIds).toEqual(expectedTypeIds);
  });
});
