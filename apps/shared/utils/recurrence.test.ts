import { describe, expect, it } from "vitest";
import {
  computeNextOccurrenceFromCursor,
  recurrenceCursorBefore,
} from "./recurrence";

describe("computeNextOccurrenceFromCursor", () => {
  it("preserves daily interval phase from the reference date", () => {
    const next = computeNextOccurrenceFromCursor(
      new Date("2026-07-01T00:00:00.000Z"),
      18,
      30,
      { frequency: "daily", interval: 2 },
      new Date("2026-07-01T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-07-03T18:30:00.000Z");
  });

  it("uses the reference week for interval-based weekly schedules", () => {
    const next = computeNextOccurrenceFromCursor(
      new Date("2026-07-06T00:00:00.000Z"),
      18,
      30,
      { frequency: "weekly", interval: 2, daysOfWeek: [1] },
      new Date("2026-07-06T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-07-20T18:30:00.000Z");
  });

  it("clamps monthly days without skipping February", () => {
    const next = computeNextOccurrenceFromCursor(
      new Date("2026-01-31T00:00:00.000Z"),
      18,
      30,
      { frequency: "monthly", interval: 1, dayOfMonth: 31 },
      new Date("2026-01-01T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-02-28T18:30:00.000Z");
  });

  it("starts from the reference UTC day without backfilling older dates", () => {
    const cursor = recurrenceCursorBefore(new Date("2026-08-09T12:00:00.000Z"));
    const next = computeNextOccurrenceFromCursor(
      cursor!,
      18,
      30,
      { frequency: "daily", interval: 1 },
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-08-09T18:30:00.000Z");
  });

  it("finds a first monthly occurrence in the current month", () => {
    const cursor = recurrenceCursorBefore(new Date("2026-01-31T12:00:00.000Z"));
    const next = computeNextOccurrenceFromCursor(
      cursor!,
      18,
      30,
      { frequency: "monthly", interval: 1, dayOfMonth: 31 },
      new Date("2026-01-31T12:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-01-31T18:30:00.000Z");
  });
});
