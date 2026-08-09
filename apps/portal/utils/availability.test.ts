import { describe, expect, it } from "vitest";
import { buildAvailabilityHeatData, parseAvailabilityRanges } from "./availability";
import type { MemberAvailability } from "@guild/shared";

function availability(
  days: Partial<MemberAvailability["days"]>,
): MemberAvailability {
  return {
    timezone: "UTC",
    days: {
      sunday: [],
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      ...days,
    },
  };
}

describe("availability utils", () => {
  it("splits overnight ranges into the current and next day", () => {
    const ranges = parseAvailabilityRanges(availability({
      friday: [{ start_utc: "22:00", end_utc: "01:00" }],
    }));

    expect(ranges.get(5)).toEqual([{ startMinutes: 22 * 60, endMinutes: 24 * 60 }]);
    expect(ranges.get(6)).toEqual([{ startMinutes: 0, endMinutes: 60 }]);
  });

  it("builds hourly heat data from active member availability only", () => {
    const heatData = buildAvailabilityHeatData([
      {
        user: {
          is_active: true,
          deleted_at: null,
        },
        profile: {
          availability: availability({ monday: [{ start_utc: "09:00", end_utc: "11:00" }] }),
        },
      },
      {
        user: {
          is_active: true,
          deleted_at: null,
        },
        profile: {
          availability: availability({ monday: [{ start_utc: "10:30", end_utc: "12:00" }] }),
        },
      },
      {
        user: {
          is_active: false,
          deleted_at: null,
        },
        profile: {
          availability: availability({ monday: [{ start_utc: "09:00", end_utc: "18:00" }] }),
        },
      },
    ]);

    expect(heatData.hourlyByDay.get(1)?.[9]).toBe(1);
    expect(heatData.hourlyByDay.get(1)?.[10]).toBe(2);
    expect(heatData.hourlyByDay.get(1)?.[11]).toBe(1);
    expect(heatData.dayPeakByDay.get(1)).toBe(2);
    expect(heatData.daysWithAny.has(1)).toBe(true);
    expect(heatData.maxCount).toBe(2);
    expect(heatData.memberCount).toBe(2);
  });
});
