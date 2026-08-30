// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildAddToPoolMove, resolveGuildWarAbsenceWindow } from "./GuildWarActiveTab";

describe("GuildWarActiveTab contracts", () => {
  it("keeps the active roster ETag when adding members to the pool", () => {
    expect(buildAddToPoolMove("event-1", ["user-1", "user-2"], '"roster-7"')).toEqual({
      event_id: "event-1",
      moves: [
        { user_id: "user-1", to: "pool" },
        { user_id: "user-2", to: "pool" },
      ],
      etag: '"roster-7"',
    });
  });

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
