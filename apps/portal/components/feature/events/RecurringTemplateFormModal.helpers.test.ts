import { describe, expect, it } from "vitest";
import { localWeekdayToUtc, utcWeekdayToLocal } from "./RecurringTemplateFormModal.helpers";

describe("recurring template weekday timezone conversion", () => {
  it("round-trips local weekday through UTC using start_at offset", () => {
    // For any local weekday + time-of-day, converting to UTC and back should be identity
    // for the local timezone the test machine runs in.
    const time = "20:00";
    for (let localDay = 0; localDay < 7; localDay++) {
      const utcDay = localWeekdayToUtc(localDay, time);
      // Build an ISO timestamp that represents the local day+time we just selected,
      // matching what timeToTodayIso would emit for this scenario.
      const probe = new Date();
      const diff = (localDay - probe.getDay() + 7) % 7;
      probe.setDate(probe.getDate() + diff);
      probe.setHours(20, 0, 0, 0);
      const startAtIso = probe.toISOString();

      expect(utcWeekdayToLocal(utcDay, startAtIso)).toBe(localDay);
    }
  });

  it("returns the input weekday when start_at is invalid", () => {
    expect(utcWeekdayToLocal(3, "not-a-date")).toBe(3);
  });

  it("returns input weekday when time string is malformed", () => {
    expect(localWeekdayToUtc(2, "")).toBe(2);
    expect(localWeekdayToUtc(5, "noon")).toBe(5);
  });
});
