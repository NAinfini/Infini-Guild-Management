import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  buildDashboardUpcomingEventsQueryParams,
  orderDashboardUpcomingRows,
} from "./DashboardPage";
import { fetchDashboardSummary } from "../../services/DashboardService";

vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async (path: string) => ({ path })),
}));

const { apiRequest } = await import("../../api/client");

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

  it("orders upcoming rows by closest start time before pinned priority", () => {
    const rows = [
      { item: { id: "may-11", start_at: "2026-05-11T22:11:00.000Z", pinned: true } },
      { item: { id: "may-08", start_at: "2026-05-08T22:11:00.000Z", pinned: false } },
      { item: { id: "may-07", start_at: "2026-05-07T22:11:00.000Z", pinned: true } },
      { item: { id: "may-09", start_at: "2026-05-09T22:11:00.000Z", pinned: false } },
    ];

    expect(orderDashboardUpcomingRows(rows as never).map((row) => row.item.id)).toEqual([
      "may-07",
      "may-08",
      "may-09",
      "may-11",
    ]);
  });

  it("fetches dashboard through one purpose-built summary endpoint", async () => {
    await fetchDashboardSummary();

    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/summary");
  });
});
