import { describe, expect, it } from "vitest";
import { LATENCY_BAD_THRESHOLD_MS, LATENCY_WARN_THRESHOLD_MS, latencyBand } from "./latency-thresholds";

describe("latency thresholds", () => {
  it("classifies values comfortably inside each band", () => {
    expect(latencyBand(0)).toBe("good");
    expect(latencyBand(LATENCY_WARN_THRESHOLD_MS - 1)).toBe("good");
    expect(latencyBand(LATENCY_WARN_THRESHOLD_MS + 1)).toBe("warn");
    expect(latencyBand(LATENCY_BAD_THRESHOLD_MS - 1)).toBe("warn");
    expect(latencyBand(LATENCY_BAD_THRESHOLD_MS + 1)).toBe("bad");
  });

  /* 这条断言是本模块存在的理由：边界值本身该落进哪一档，此前两处重复实现里
   * 谁都没有专门测过。如果哪天有人手滑把 `<` 改成 `<=`，边界毫秒数会静默滑到
   * 另一档，而两处重复实现又会各自滑向不同的方向。 */
  it("puts the boundary values in the worse band, not the better one", () => {
    expect(latencyBand(LATENCY_WARN_THRESHOLD_MS)).toBe("warn");
    expect(latencyBand(LATENCY_BAD_THRESHOLD_MS)).toBe("bad");
  });

  /* 上一版这里断言「每个毫秒值都落进三档之一」——latencyBand() 的返回类型
   * 已经把取值域约束成这三个字符串，这条断言近乎恒真，抓不住阈值写反、
   * 两个常量填反、比较号方向写反这些真实错误（task-8 修复轮次 1，对应
   * review 里的 T-1）。改成断言跳变点：0..600 里 band 只应该在两个
   * 常量处变化，且只能往更差的方向走，这样任何一类真实错误都会让
   * transitions 数组跟两个常量对不上。 */
  it("changes band only at the two threshold boundaries", () => {
    const transitions: number[] = [];
    for (let ms = 1; ms <= 600; ms += 1) {
      if (latencyBand(ms) !== latencyBand(ms - 1)) transitions.push(ms);
    }
    expect(transitions).toEqual([LATENCY_WARN_THRESHOLD_MS, LATENCY_BAD_THRESHOLD_MS]);
  });
});
