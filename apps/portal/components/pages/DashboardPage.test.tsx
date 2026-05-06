import { describe, expect, it } from "vitest";
import {
  DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  buildDashboardUpcomingEventsQueryParams,
} from "./DashboardPage";

describe("DashboardPage upcoming event query", () => {
  it("requests the next seven days of unarchived upcoming events", () => {
    const now = new Date("2026-05-06T16:15:00.000Z");

    expect(buildDashboardUpcomingEventsQueryParams(now)).toEqual({
      page: 1,
      limit: 20,
      archived: false,
      start_after: "2026-05-06T16:15:00.000Z",
      start_before: "2026-05-13T16:15:00.000Z",
    });
  });

  it("keeps upcoming event data fresh for read-only dashboard viewers", () => {
    expect(DASHBOARD_EVENTS_REFETCH_INTERVAL_MS).toBe(60_000);
  });
});
