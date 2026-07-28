import { describe, expect, it } from "vitest";
import { resolveGuildWarAbsenceWindow } from "./GuildWarActiveTab";

describe("resolveGuildWarAbsenceWindow", () => {
  it("waits for the selected event date instead of falling back to today", () => {
    expect(resolveGuildWarAbsenceWindow(undefined)).toBeNull();
    expect(resolveGuildWarAbsenceWindow(null)).toBeNull();
  });

  it("queries absences for the selected event day", () => {
    expect(resolveGuildWarAbsenceWindow("2026-08-14T20:00:00.000Z")).toEqual({
      from: "2026-08-14",
      to: "2026-08-14",
    });
  });
});
