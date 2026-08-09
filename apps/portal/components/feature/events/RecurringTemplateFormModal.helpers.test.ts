import { describe, expect, it } from "vitest";
import { localWeekdayToUtc, utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import { buildRecurrenceRule, localTimeToUtcTime, utcTimeToLocalTime } from "./RecurringTemplateFormModal.helpers";

describe("recurring template discriminated rules", () => {
  const state = {
    recurrenceInterval: "2",
    recurrenceDays: [1, 3],
    recurrenceMonthDay: "31",
    recurrenceEndDate: "2026-12-31",
    recurrenceEndCount: "8",
  };

  it("emits only daily fields and the selected count ending", () => {
    expect(buildRecurrenceRule({
      ...state,
      recurrenceFreq: "daily",
      recurrenceEndMode: "count",
    }, "not-a-date")).toEqual({ frequency: "daily", interval: 2, endAfter: 8 });
  });

  it("emits only weekly fields and the selected date ending", () => {
    expect(buildRecurrenceRule({
      ...state,
      recurrenceFreq: "weekly",
      recurrenceEndMode: "date",
    }, "not-a-date")).toEqual({
      frequency: "weekly",
      interval: 2,
      daysOfWeek: [1, 3],
      endDate: "2026-12-31T00:00:00.000Z",
    });
  });

  it("drops stale weekly and ending fields after switching to monthly/never", () => {
    expect(buildRecurrenceRule({
      ...state,
      recurrenceFreq: "monthly",
      recurrenceEndMode: "never",
    }, "not-a-date")).toEqual({
      frequency: "monthly",
      interval: 2,
      dayOfMonth: 31,
    });
  });
});

describe("recurring template weekday timezone conversion", () => {
  it("round-trips every weekday through UTC and back, anchored on start_at", () => {
    // localWeekdayToUtc and utcWeekdayToLocal must be exact inverses when both
    // are anchored on the same start_at instant — independent of the host
    // timezone the test runs in.
    const startAtIso = new Date().toISOString();
    for (let localDay = 0; localDay < 7; localDay++) {
      const utcDay = localWeekdayToUtc(localDay, startAtIso);
      expect(utcWeekdayToLocal(utcDay, startAtIso)).toBe(localDay);
    }
  });

  it("reverse round-trips every stored UTC weekday back through local", () => {
    const startAtIso = new Date().toISOString();
    for (let utcDay = 0; utcDay < 7; utcDay++) {
      const localDay = utcWeekdayToLocal(utcDay, startAtIso);
      expect(localWeekdayToUtc(localDay, startAtIso)).toBe(utcDay);
    }
  });

  it("matches the local/UTC day shift of the start_at instant", () => {
    // The conversion's only job is to apply the start_at instant's own
    // local→UTC day shift, so it must agree with that instant's getDay/getUTCDay.
    // This holds across DST boundaries and near-midnight times because the shift
    // is read from start_at itself, not from "today".
    const samples = [
      "2026-03-08T07:30:00.000Z", // US spring-forward day, near local midnight
      "2026-11-01T06:30:00.000Z", // US fall-back day
      "2026-06-15T00:30:00.000Z",
      "2026-12-31T23:30:00.000Z",
    ];
    for (const iso of samples) {
      const instant = new Date(iso);
      const expectedShift = ((instant.getUTCDay() - instant.getDay()) % 7 + 7) % 7;
      for (let localDay = 0; localDay < 7; localDay++) {
        expect(localWeekdayToUtc(localDay, iso)).toBe((localDay + expectedShift) % 7);
      }
    }
  });

  it("returns the input weekday when start_at is invalid", () => {
    expect(utcWeekdayToLocal(3, "not-a-date")).toBe(3);
    expect(localWeekdayToUtc(2, "not-a-date")).toBe(2);
    expect(localWeekdayToUtc(5, "")).toBe(5);
  });
});

describe("start time local↔UTC conversion", () => {
  it("round-trips every conversion direction, independent of host timezone", () => {
    for (const time of ["00:00", "04:30", "12:00", "23:59"]) {
      expect(utcTimeToLocalTime(localTimeToUtcTime(time))).toBe(time);
      expect(localTimeToUtcTime(utcTimeToLocalTime(time))).toBe(time);
    }
  });

  it("applies the viewer's current offset and wraps at midnight", () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    const totalLocal = (((23 * 60 + 30 + offsetMinutes) % 1440) + 1440) % 1440;
    const expected = `${String(Math.floor(totalLocal / 60)).padStart(2, "0")}:${String(totalLocal % 60).padStart(2, "0")}`;
    expect(utcTimeToLocalTime("23:30")).toBe(expected);
  });

  it("returns invalid input verbatim so bad data stays visible", () => {
    expect(utcTimeToLocalTime("not-a-time")).toBe("not-a-time");
    expect(localTimeToUtcTime("25:00")).toBe("25:00");
  });
});
