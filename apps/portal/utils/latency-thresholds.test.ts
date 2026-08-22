// @vitest-environment node
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

  /* Boundary values intentionally enter the worse band. */
  it("puts the boundary values in the worse band, not the better one", () => {
    expect(latencyBand(LATENCY_WARN_THRESHOLD_MS)).toBe("warn");
    expect(latencyBand(LATENCY_BAD_THRESHOLD_MS)).toBe("bad");
  });

  /* Assert transition points so swapped thresholds or comparison directions cannot pass. */
  it("changes band only at the two threshold boundaries", () => {
    const transitions: number[] = [];
    for (let ms = 1; ms <= 600; ms += 1) {
      if (latencyBand(ms) !== latencyBand(ms - 1)) transitions.push(ms);
    }
    expect(transitions).toEqual([LATENCY_WARN_THRESHOLD_MS, LATENCY_BAD_THRESHOLD_MS]);
  });
});
