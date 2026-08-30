// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_CLOCK_TICK_MS,
  isDashboardEventStartingSoon,
  orderDashboardUpcomingRows,
  participantToDashboardMember,
  roundDashboardNow,
  summarizeDashboardAttention,
} from "./DashboardPage";
import { announcementQueryKeys } from "../../services/AnnouncementService";
import {
  dashboardQueryKeys,
  fetchDashboardEvents,
  fetchDashboardWars,
} from "../../services/DashboardService";

vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async (path: string) => ({ path })),
}));

const { apiRequest } = await import("../../api/client");

describe("DashboardPage upcoming event query", () => {
  it("summarizes only real event schedule and lineup conditions", () => {
    expect(summarizeDashboardAttention([
      {
        startsSoon: true,
        hasConflict: false,
        isFull: true,
        quotaSummary: { matchedTotal: 1, requiredTotal: 2 },
      },
      {
        startsSoon: false,
        hasConflict: true,
        isFull: false,
        quotaSummary: { matchedTotal: 2, requiredTotal: 2 },
      },
    ] as never)).toEqual({
      startsSoon: 1,
      conflicts: 1,
      full: 1,
      quotaShortfalls: 1,
    });
  });

  it("rounds the dashboard clock without retaining mutable module state", () => {
    const input = new Date("2026-05-06T16:17:42.000Z");
    const rounded = roundDashboardNow(input);

    expect(rounded.toISOString()).toBe("2026-05-06T16:15:00.000Z");
    expect(rounded).not.toBe(input);
    expect(input.toISOString()).toBe("2026-05-06T16:17:42.000Z");
  });

  it("advances time locally without reusing the announcement list cache shape", () => {
    expect(DASHBOARD_CLOCK_TICK_MS).toBe(60_000);
    expect(dashboardQueryKeys.latestAnnouncement()).not.toEqual(
      announcementQueryKeys.list("published", "all", "", "updated_desc"),
    );
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

  it("maps dashboard participants without fabricating full user or profile records", () => {
    expect(
      participantToDashboardMember({
        user_id: "user-1",
        display_name: "Aster",
        role: "member",
        classes: ["tank"],
        power: 4200,
        avatar_media_id: "avatar1234567890abcde",
      }),
    ).toEqual({
      user: {
        id: "user-1",
        display_name: "Aster",
      },
      profile: {
        classes: ["tank"],
        power: 4200,
        avatar_media_id: "avatar1234567890abcde",
      },
    });
  });

  it("fetches event and war cards through independent endpoints", async () => {
    await Promise.all([
      fetchDashboardEvents(),
      fetchDashboardWars(),
    ]);

    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/events");
    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/wars");
  });

  it("isolates dashboard caches by viewer and applies public visibility in external view", async () => {
    expect(dashboardQueryKeys.events("admin-1", false)).not.toEqual(
      dashboardQueryKeys.events("guest", false),
    );
    expect(dashboardQueryKeys.wars("admin-1", false)).not.toEqual(
      dashboardQueryKeys.wars("guest", false),
    );
    expect(dashboardQueryKeys.wars("admin-1", false)).not.toEqual(
      dashboardQueryKeys.wars("admin-1", true),
    );

    await fetchDashboardEvents({ externalView: true });
    await fetchDashboardWars({ externalView: true });

    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/events?external_view=true");
    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/wars?external_view=true");
  });

  it("treats only future starts within the exact six-hour window as urgent", () => {
    const now = new Date("2026-05-06T12:00:00.000Z");

    expect(isDashboardEventStartingSoon(new Date("2026-05-06T11:59:59.999Z"), now)).toBe(false);
    expect(isDashboardEventStartingSoon(new Date("2026-05-06T12:00:00.000Z"), now)).toBe(true);
    expect(isDashboardEventStartingSoon(new Date("2026-05-06T18:00:00.000Z"), now)).toBe(true);
    expect(isDashboardEventStartingSoon(new Date("2026-05-06T18:00:00.001Z"), now)).toBe(false);
  });
});
