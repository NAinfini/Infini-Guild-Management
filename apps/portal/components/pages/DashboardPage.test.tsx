// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_EVENTS_REFETCH_INTERVAL_MS,
  isDashboardEventStartingSoon,
  orderDashboardUpcomingRows,
  participantToDashboardMember,
  roundDashboardNow,
  summarizeDashboardAttention,
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
  it("puts my signups directly above upcoming events in the left dashboard column", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/DashboardPage.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/DashboardPage.css"),
      "utf8",
    );
    const sectionPositions = [
      source.indexOf("dashboard-workspace__main"),
      source.indexOf("dashboard-workspace__signups"),
      source.indexOf("dashboard-workspace__upcoming"),
      source.indexOf("dashboard-workspace__aside"),
      source.indexOf("dashboard-workspace__announcement"),
      source.indexOf("dashboard-workspace__attention"),
      source.indexOf("dashboard-workspace__war"),
    ];

    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
    expect(source).not.toContain("dashboard-workspace__lower");
    expect(styles).toMatch(/\.dashboard-workspace\s*\{[^}]*grid-template-columns:/s);
    expect(styles).toMatch(/\.dashboard-workspace__aside\s*\{[^}]*display:\s*grid/s);
    expect(styles).toMatch(/@media \(max-width: 64rem\)[\s\S]*\.dashboard-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(styles).toMatch(/@media \(max-width: 64rem\)[\s\S]*\.dashboard-workspace__main,[\s\S]*display:\s*contents/);
    expect(styles).toMatch(/\.dashboard-workspace__attention\s*\{[^}]*order:\s*2/);
    expect(styles).toMatch(/\.dashboard-workspace__upcoming\s*\{[^}]*order:\s*3/);
  });

  it("uses one personalized command briefing without duplicating the primary navigation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/DashboardPage.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/DashboardPage.css"),
      "utf8",
    );

    expect(source).toContain('className="dashboard-briefing"');
    expect(source).toContain('t("welcome"');
    expect(source).toContain('t("briefing.description"');
    expect(source).toContain('className="dashboard-briefing__metrics"');
    expect(source).not.toContain('t("command.action.roster"');
    expect(source).not.toContain('t("command.action.guildWar"');
    expect(source).not.toContain("fetchDashboardMemberStats");
    expect(source).toContain('className="dashboard-bulletin-card gap-0 py-0"');
    expect(source).toContain("<DashboardGuildPulse items={pulseItems} />");
    expect(source).toContain('aria-pressed={paused}');
    expect(source).toContain("fetchInboxNotifications");
    expect(source).toContain("<DashboardActivityCard");
    expect(styles).not.toContain("--page-layout-max-width");
    expect(styles).not.toContain("--shadow-card");
    expect(styles).toMatch(/\.dashboard-briefing\s*\{/);
    expect(styles).toMatch(/\.dashboard-briefing__metrics\s*\{[^}]*grid-template-columns:/s);
    expect(styles).toMatch(/\.dashboard-bulletin-card\s*\{/);
    expect(styles).toMatch(/\.dashboard-pulse\[data-paused\][\s\S]*animation-play-state:\s*paused/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dashboard-pulse__track\s*\{[\s\S]*animation:\s*none !important/);
  });

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
