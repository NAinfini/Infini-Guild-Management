import { activeGame } from "@guild/shared/games";
import { describe, expect, it } from "vitest";
import { EVENT_TYPE_COLORS, UNKNOWN_EVENT_TYPE_COLOR } from "./event-colors";

describe("event colours", () => {
  it("covers every configured event type", () => {
    expect(Object.keys(EVENT_TYPE_COLORS).sort()).toEqual(
      activeGame.eventTypes.map((et) => et.id).sort(),
    );
  });

  /* 这条断言是本模块存在的理由。兜底色与任一已登记类型撞色时，未知类型
   * （数据异常）会渲染成合法类型的样子 —— 静默伪装，看不出来。此前那张表被
   * 抄了三份，兜底分叉成 gray / gray / lime，其中 gray 正好撞上 other。
   * 收敛成一份之后，撞色不再有横向对照能发现，只能靠这条断言。 */
  it("uses a fallback colour that no configured type already claims", () => {
    const claimed = Object.values(EVENT_TYPE_COLORS);
    expect(claimed).not.toContain(UNKNOWN_EVENT_TYPE_COLOR);
  });
});
