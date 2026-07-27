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

  it("covers every millisecond value with exactly one band, no gaps", () => {
    for (let ms = 0; ms <= 600; ms += 1) {
      expect(["good", "warn", "bad"]).toContain(latencyBand(ms));
    }
  });
});
