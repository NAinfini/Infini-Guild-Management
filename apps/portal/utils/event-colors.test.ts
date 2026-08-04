import { DEFAULT_GAME_RULES } from "@guild/shared";
import { describe, expect, it } from "vitest";
import { UNKNOWN_EVENT_TYPE_COLOR } from "./event-colors";
import { getEventTypeColor } from "./game-rules";

describe("event colours", () => {
  it("uses the colour stored on each configured event type", () => {
    for (const definition of DEFAULT_GAME_RULES.events.types) {
      expect(getEventTypeColor(definition.id, DEFAULT_GAME_RULES)).toBe(definition.color);
    }
  });

  /* 这条断言是本模块存在的理由。兜底色与任一已登记类型撞色时，未知类型
   * （数据异常）会渲染成合法类型的样子 —— 静默伪装，看不出来。此前那张表被
   * 抄了三份，兜底分叉成 gray / gray / lime，其中 gray 正好撞上 other。
   * 收敛成一份之后，撞色不再有横向对照能发现，只能靠这条断言。 */
  it("uses a fallback colour that no configured type already claims", () => {
    const claimed = DEFAULT_GAME_RULES.events.types.map((definition) => definition.color);
    expect(claimed).not.toContain(UNKNOWN_EVENT_TYPE_COLOR);
  });
});
