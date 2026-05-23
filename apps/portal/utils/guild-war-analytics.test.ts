import { describe, expect, it } from "vitest";
import {
  aggregateValues,
  computeStdDev,
  getMetricLabelKey,
  hashToPaletteColor,
  metricValueFromWarMember,
  metricValueOrNullFromWarMember,
  normalizeMetricValue,
} from "./guild-war-analytics";

describe("guild war analytics utilities", () => {
  it("normalizes metrics by duration and modifier", () => {
    expect(normalizeMetricValue(60, "damage", 15, 30, 1.5)).toBe(180);
  });

  it("normalizes lower-is-better metrics by dividing modifier", () => {
    expect(normalizeMetricValue(6, "deaths", 30, 30, 2)).toBe(3);
  });

  it("aggregates totals, averages, best values, medians, and empty data", () => {
    expect(aggregateValues([1, 2, 3], "total")).toBe(6);
    expect(aggregateValues([1, 2, 3], "average")).toBe(2);
    expect(aggregateValues([1, 2, 3], "best")).toBe(3);
    expect(aggregateValues([1, 2, 100, 101], "median")).toBe(51);
    expect(aggregateValues([], "total")).toBe(0);
  });

  it("computes stable standard deviation", () => {
    expect(computeStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(computeStdDev([10])).toBe(0);
  });

  it("extracts raw and computed member metrics", () => {
    const member = { stats: { kills: 4, deaths: 2, assists: 6, damage: 100 } };

    expect(metricValueFromWarMember(member, "damage")).toBe(100);
    expect(metricValueFromWarMember(member, "kda")).toBe(5);
    expect(metricValueOrNullFromWarMember({ stats: null }, "damage")).toBeNull();
    expect(metricValueOrNullFromWarMember({ stats: null }, "kda")).toBeNull();
  });

  it("resolves labels and palette colors with fallback behavior", () => {
    expect(getMetricLabelKey("kda")).toBe("analytics.metric.kda");
    expect(getMetricLabelKey("unknown_metric")).toBe("unknown_metric");
    expect(hashToPaletteColor("alice", ["red", "blue"])).toMatch(/red|blue/);
    expect(hashToPaletteColor("alice", [])).toBe("var(--ant-color-primary)");
  });
});
