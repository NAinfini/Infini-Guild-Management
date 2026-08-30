import { describe, expect, it } from "vitest";
import { buildVisiblePages } from "./pagination";

describe("buildVisiblePages", () => {
  it("keeps large page ranges bounded around the current page", () => {
    expect(buildVisiblePages(5000, 10_000)).toEqual([
      1,
      "ellipsis",
      4999,
      5000,
      5001,
      "ellipsis",
      10_000,
    ]);
  });

  it("shows every page for a short range", () => {
    expect(buildVisiblePages(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
