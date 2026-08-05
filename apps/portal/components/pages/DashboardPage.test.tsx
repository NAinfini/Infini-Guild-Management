import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  DASHBOARD_MOBILE_MEDIA_QUERY,
  orderDashboardUpcomingRows,
  participantToDashboardMember,
  roundDashboardNow,
} from "./DashboardPage";
import {
  dashboardQueryKeys,
  fetchDashboardEvents,
  fetchDashboardMemberStats,
  fetchDashboardWars,
} from "../../services/DashboardService";

vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async (path: string) => ({ path })),
}));

const { apiRequest } = await import("../../api/client");

describe("DashboardPage upcoming event query", () => {
  it("uses the shared mobile breakpoint for the action-first composition", () => {
    expect(DASHBOARD_MOBILE_MEDIA_QUERY).toBe("(max-width: 47.99em)");
  });

  it("renders mobile actions before member stats and the last war", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/DashboardPage.tsx"),
      "utf8",
    );
    const mobileBranchStart = source.indexOf("{isMobileDashboard ? (");
    const mobileBranch = source.slice(
      mobileBranchStart,
      source.indexOf(") : (", mobileBranchStart),
    );
    const sectionPositions = [
      mobileBranch.indexOf("{actionsColumn ?"),
      mobileBranch.indexOf("{activeMembersCard}"),
      mobileBranch.indexOf("{lastWarCard ?"),
    ];

    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
  });

  it("rounds the dashboard clock without retaining mutable module state", () => {
    const input = new Date("2026-05-06T16:17:42.000Z");
    const rounded = roundDashboardNow(input);

    expect(rounded.toISOString()).toBe("2026-05-06T16:15:00.000Z");
    expect(rounded).not.toBe(input);
    expect(input.toISOString()).toBe("2026-05-06T16:17:42.000Z");
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

  it("maps dashboard participants without fabricating full user or profile records", () => {
    expect(
      participantToDashboardMember({
        user_id: "user-1",
        username: "Aster",
        role: "member",
        classes: ["tank"],
        power: 4200,
        avatar_key: "members/user-1/avatar.webp",
      }),
    ).toEqual({
      user: {
        id: "user-1",
        username: "Aster",
      },
      profile: {
        classes: ["tank"],
        power: 4200,
        avatar_key: "members/user-1/avatar.webp",
      },
    });
  });

  it("fetches member, event, and war cards through independent endpoints", async () => {
    await Promise.all([
      fetchDashboardMemberStats(),
      fetchDashboardEvents(),
      fetchDashboardWars(),
    ]);

    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/members");
    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/events");
    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/wars");
  });

  it("isolates event caches by viewer and applies public visibility in external view", async () => {
    expect(dashboardQueryKeys.events("admin-1", false)).not.toEqual(
      dashboardQueryKeys.events("guest", false),
    );

    await fetchDashboardEvents({ externalView: true });

    expect(apiRequest).toHaveBeenCalledWith("/api/dashboard/events?external_view=true");
  });
});
