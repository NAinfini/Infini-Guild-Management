// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EMPTY_TIME_TEXT,
  formatCalendarDate,
  formatCalendarParts,
  formatClock,
  formatDateTime,
  fromDateTimeLocalValue,
  isIsoDate,
  localClockToUtc,
  localDateKey,
  parseClockMinutes,
  toDateTimeLocalValue,
  toIsoOrNow,
  utcClockToLocal,
  viewerUtcOffsetMinutes,
  wrapWeekMinute,
  WEEK_MINUTES,
} from "./datetime";

/* 这些断言不依赖跑测试的机器在哪个时区：要么两边一起换算后回到原处，要么用本地
   挂钟造出来的时刻再按本地读回去。唯一带条件的那条明说了为什么。 */

describe("viewerUtcOffsetMinutes", () => {
  it("counts east as positive, the opposite of getTimezoneOffset", () => {
    expect(viewerUtcOffsetMinutes()).toBe(-new Date().getTimezoneOffset());
  });
});

describe("localDateKey", () => {
  it("reads the viewer's calendar day, not the UTC day", () => {
    /* 本地挂钟的跨年前后各取一刻：偏东的机器上前一条与 UTC 那天不同，偏西的机器上
       后一条不同，只有正好在 UTC 上两条才都相同。 */
    expect(localDateKey(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
    expect(localDateKey(new Date(2027, 0, 1, 0, 30))).toBe("2027-01-01");
  });

  it("falls back to the placeholder instead of printing Invalid Date", () => {
    expect(localDateKey("not-a-date")).toBe(EMPTY_TIME_TEXT);
  });
});

describe("datetime-local round trip", () => {
  it("returns the same instant after going out to the control and back", () => {
    const iso = new Date(2026, 7, 13, 19, 12).toISOString();
    expect(fromDateTimeLocalValue(toDateTimeLocalValue(iso))).toBe(iso);
  });

  it("hands back nothing when the field is empty or half-typed", () => {
    expect(fromDateTimeLocalValue("")).toBeUndefined();
    expect(fromDateTimeLocalValue("   ")).toBeUndefined();
    /* new Date("2026-08") 是合法的，会当成 UTC 八月一号零点——日、时、时区全是编的。 */
    expect(fromDateTimeLocalValue("2026-08")).toBeUndefined();
    expect(fromDateTimeLocalValue("2026-08-13")).toBeUndefined();
    expect(fromDateTimeLocalValue("2026-02-30T10:00")).toBeUndefined();
    expect(fromDateTimeLocalValue("2026-08-13T25:00")).toBeUndefined();
    expect(toDateTimeLocalValue(null)).toBe("");
  });

  it("reads the control's value as the viewer's own wall clock", () => {
    expect(fromDateTimeLocalValue("2026-08-13T19:12"))
      .toBe(new Date(2026, 7, 13, 19, 12).toISOString());
  });
});

describe("wall-clock conversion", () => {
  it("round-trips in both directions", () => {
    for (const time of ["00:00", "04:30", "12:00", "23:59"]) {
      expect(utcClockToLocal(localClockToUtc(time))).toBe(time);
      expect(localClockToUtc(utcClockToLocal(time))).toBe(time);
    }
  });

  it("applies the viewer's offset and wraps at midnight", () => {
    const total = ((23 * 60 + 30 + viewerUtcOffsetMinutes()) % 1440 + 1440) % 1440;
    const expected = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    expect(utcClockToLocal("23:30")).toBe(expected);
  });

  it("returns unreadable input verbatim so bad data stays visible", () => {
    expect(utcClockToLocal("not-a-time")).toBe("not-a-time");
    expect(localClockToUtc("25:00")).toBe("25:00");
  });
});

describe("parseClockMinutes", () => {
  it("accepts a real wall clock and rejects anything else", () => {
    expect(parseClockMinutes("00:00")).toBe(0);
    expect(parseClockMinutes("23:59")).toBe(1439);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseClockMinutes("12:60")).toBeNull();
    expect(parseClockMinutes("noon")).toBeNull();
  });
});

describe("wrapWeekMinute", () => {
  it("folds both directions back into one week", () => {
    expect(wrapWeekMinute(-30)).toBe(WEEK_MINUTES - 30);
    expect(wrapWeekMinute(WEEK_MINUTES + 30)).toBe(30);
  });
});

describe("formatCalendarDate", () => {
  it("shows the written day whatever timezone the viewer is in", () => {
    /* 这是这套换算里最容易错的一条：请假从 8 月 13 日起就是 13 日，不是某个瞬时点。
       按本地时区渲染的话，西半球会整整差一天。 */
    expect(formatCalendarDate("2026-08-13", "en-US")).toBe("Aug 13, 2026");
    expect(formatCalendarDate("2026-01-01", "en-US")).toBe("Jan 1, 2026");
  });

  it("keeps a day that does not exist visible instead of rolling it forward", () => {
    expect(formatCalendarDate("2026-02-30", "en-US")).toBe("2026-02-30");
    expect(formatCalendarDate("", "en-US")).toBe(EMPTY_TIME_TEXT);
  });

  it("hands the control overlay an empty string so the placeholder shows through", () => {
    expect(formatCalendarParts("2026-2-3", "en-US", { day: "numeric" })).toBe("");
    expect(formatCalendarParts("2026-08-13", "en-US", { day: "numeric" })).toBe("13");
  });
});

describe("display formatting", () => {
  it("marks unreadable values instead of rendering Invalid Date", () => {
    expect(formatDateTime(null)).toBe(EMPTY_TIME_TEXT);
    expect(formatDateTime("not-a-date")).toBe(EMPTY_TIME_TEXT);
    expect(formatClock(undefined)).toBe(EMPTY_TIME_TEXT);
  });

  it("prints a 24-hour clock, with seconds only when asked", () => {
    const at = new Date(2026, 7, 13, 19, 12, 45);
    expect(formatClock(at)).toBe("19:12");
    expect(formatClock(at, { seconds: true })).toBe("19:12:45");
  });
});

describe("stored ISO fallbacks", () => {
  it("only accepts strings that read back as a time", () => {
    expect(isIsoDate("2026-08-13T19:12:00.000Z")).toBe(true);
    expect(isIsoDate("later")).toBe(false);
  });

  it("substitutes now for a cursor it cannot read", () => {
    const kept = "2026-08-13T19:12:00.000Z";
    expect(toIsoOrNow(kept)).toBe(kept);
    expect(isIsoDate(toIsoOrNow(undefined))).toBe(true);
    expect(isIsoDate(toIsoOrNow("garbage"))).toBe(true);
  });
});
