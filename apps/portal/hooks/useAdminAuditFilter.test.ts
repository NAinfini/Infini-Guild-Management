import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { matchAuditDatePreset, useAdminAuditFilter } from "./useAdminAuditFilter";

/* 不借 date-fns 复述实现，自己按本地时区拼一份 yyyy-MM-dd。 */
function isoDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

describe("useAdminAuditFilter", () => {
  /* 七天兼顾近期排障和趋势回看，且不会把整本审计日志拉出来。 */
  it("starts on the last seven days instead of an open-ended range", () => {
    const { result } = renderHook(() => useAdminAuditFilter());

    expect(result.current.auditFilter.dateFrom).toBe(isoDate(7));
    expect(result.current.auditFilter.dateTo).toBe(isoDate(0));
  });

  /*
   * 正反两个方向共用同一张天数表：预设算出来的区间，必须能被反推认回同一个预设。
   * 对不上就意味着工具条会高亮「自定义」，而实际过滤的是某个预设区间。
   */
  it("recognises every range its own presets produce", () => {
    const { result } = renderHook(() => useAdminAuditFilter());

    for (const preset of ["1d", "7d", "1m"] as const) {
      act(() => result.current.setAuditDatePreset(preset));
      const { dateFrom, dateTo } = result.current.auditFilter;
      expect(matchAuditDatePreset(dateFrom, dateTo), preset).toBe(preset);
    }
  });

  it("calls a hand-picked or cleared range custom", () => {
    expect(matchAuditDatePreset("", "")).toBeNull();
    expect(matchAuditDatePreset("2020-01-01", "2020-03-05")).toBeNull();
  });

  it("sets and clears one exact entity timeline without a second state source", () => {
    const { result } = renderHook(() => useAdminAuditFilter());

    act(() => result.current.setAuditEntityTarget("event", "event-42"));
    expect(result.current.auditFilter).toMatchObject({ entityType: "event", entityId: "event-42" });

    act(() => result.current.clearAuditEntityTarget());
    expect(result.current.auditFilter).toMatchObject({ entityType: "", entityId: "" });
  });
});
