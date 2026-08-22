// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { localWeekdayToUtc, utcWeekdayToLocal } from "@guild/shared/utils/recurrence";
import type { RecurringTemplate } from "@guild/shared";
import {
  buildFormState,
  buildRecurrenceRule,
  computeNextLifecyclePreview,
  type RecurringTemplateFormState,
} from "./RecurringTemplateFormModal.helpers";

function inNewYorkTime<T>(callback: () => T): T {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    return callback();
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
}

function formState(overrides: Partial<RecurringTemplateFormState> = {}): RecurringTemplateFormState {
  return {
    title: "Weekly Raid",
    eventType: "social",
    description: "",
    startTime: "14:30",
    durationValue: 2,
    durationUnit: "hours",
    capacity: "",
    classQuotas: [],
    visibilityOffsetDays: 0,
    visibilityOffsetHours: 0,
    visibilityOffsetMinutes: 0,
    autoArchive: false,
    recurrenceFreq: "daily",
    recurrenceInterval: "1",
    recurrenceDays: [3],
    recurrenceMonthDay: "1",
    recurrenceEndMode: "never",
    recurrenceEndDate: "",
    recurrenceEndCount: "13",
    ...overrides,
  };
}

function template(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: "tpl-1",
    type: "social",
    title: "Weekly Raid",
    description: null,
    start_time: "04:30",
    duration_minutes: null,
    capacity: null,
    recurrence_rule: { frequency: "weekly", interval: 1, daysOfWeek: [3] },
    visibility_offset_minutes: 0,
    auto_archive: false,
    attachments: [],
    class_quotas: [],
    paused: false,
    created_by: "user-1",
    last_generated_date: null,
    generation_count: 0,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

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

  it("preserves monthly day 31 through form state and resave", () => {
    const form = buildFormState(template({
      recurrence_rule: { frequency: "monthly", interval: 1, dayOfMonth: 31 },
    }));

    expect(form.recurrenceMonthDay).toBe("31");
    expect(buildRecurrenceRule(form, "not-a-date")).toEqual({
      frequency: "monthly",
      interval: 1,
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

  it("uses the template's actual summer date instead of a fixed winter anchor", () => {
    inNewYorkTime(() => {
      const state = buildFormState(template());
      expect(state.startTime).toBe("00:30");
      expect(state.recurrenceDays).toEqual([3]);
    });
  });

});

describe("recurring template lifecycle preview", () => {
  it("uses the same first cursor as backend materialization", () => {
    inNewYorkTime(() => {
      vi.useFakeTimers();
      vi.setSystemTime("2026-07-01T12:00:00.000Z");
      try {
        expect(computeNextLifecyclePreview(formState(), null, "create")?.startTime.toISOString())
          .toBe("2026-07-01T18:30:00.000Z");
        expect(computeNextLifecyclePreview(formState(), template({
          start_time: "18:30",
          recurrence_rule: { frequency: "daily", interval: 1 },
          created_at: "2026-06-30T12:00:00.000Z",
        }), "edit")?.startTime.toISOString()).toBe("2026-07-01T18:30:00.000Z");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
