import { describe, expect, it } from "vitest";
import { computeNextOccurrence } from "./recurrence";

describe("computeNextOccurrence", () => {
  it("advances daily schedules by their interval", () => {
    const next = computeNextOccurrence(
      new Date("2026-07-01T12:00:00.000Z"),
      18,
      30,
      { frequency: "daily", interval: 2 },
      new Date("2026-07-01T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-07-03T18:30:00.000Z");
  });

  it("uses the reference week for interval-based weekly schedules", () => {
    const next = computeNextOccurrence(
      new Date("2026-07-06T18:30:00.000Z"),
      18,
      30,
      { frequency: "weekly", interval: 2, daysOfWeek: [1] },
      new Date("2026-07-06T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-07-20T18:30:00.000Z");
  });

  it("clamps explicit monthly days to the available days in the target month", () => {
    const next = computeNextOccurrence(
      new Date("2026-01-28T18:30:00.000Z"),
      18,
      30,
      { frequency: "monthly", interval: 1, dayOfMonth: 31 },
      new Date("2026-01-01T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-02-28T18:30:00.000Z");
  });
});
