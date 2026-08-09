// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsMetricKey } from "../../types/guild-war";
import { useGuildWarAnalyticsComputed } from "./useGuildWarAnalyticsComputed";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

type Member = { user_id: string; stats: Record<string, number | null> | null };

function member(userId: string, damage: number): Member {
  return { user_id: userId, stats: { damage } };
}

/**
 * One war, two teams. Alpha's members are wildly larger than Bravo's, which is
 * exactly the case the old single-stack math got wrong: it divided by the
 * combined roster total, so Bravo's members read as a rounding error instead of
 * as halves of their own team.
 */
const WAR_DETAILS = [
  {
    id: "war-1",
    war_name: "War One",
    created_at: "2026-07-01T00:00:00.000Z",
    result: "win",
    member_stats: [
      { user_id: "u1", username: "Ann", stats: { damage: 900 } },
      { user_id: "u2", username: "Ben", stats: { damage: 100 } },
      { user_id: "u3", username: "Cai", stats: { damage: 5 } },
      { user_id: "u4", username: "Dee", stats: { damage: 5 } },
    ],
    teams: [
      { team_name: "Alpha", members: [member("u1", 900), member("u2", 100)] },
      { team_name: "Bravo", members: [member("u3", 5), member("u4", 5)] },
    ],
  },
];

function renderContributionOption(selectedTeams: string[] = []) {
  return renderHook(() =>
    useGuildWarAnalyticsComputed({
      analyticsMode: "teams",
      analyticsSelectedMetrics: ["damage"] as AnalyticsMetricKey[],
      analyticsAggregation: "total",
      analyticsMinParticipation: 0,
      analyticsTopN: 10,
      analyticsSelectedTeams: selectedTeams,
      analyticsTeamAggregation: "total",
      analyticsSelectedUsers: [],
      analyticsOnlyParticipated: false,
      analyticsNormEnabled: false,
      analyticsShowDeviation: false,
      analyticsShowContribution: true,
      analyticsWarDetails: WAR_DETAILS,
      analyticsWars: [],
      analyticsWarStat: "score",
      analyticsRows: [],
      analyticsAbsences: [],
      warNormContext: new Map(),
      referenceDuration: 30,
      chartPalette: ["#111111", "#222222", "#333333", "#444444"],
      getMetricLabelKey: (metric) => `metric.${metric}`,
      metricValueFromWarMember: (row, metric) => row.stats?.[metric] ?? 0,
      metricValueOrNullFromWarMember: (row, metric) => row.stats?.[metric] ?? null,
      normalizeMetricValue: (rawValue) => rawValue,
    }),
  ).result.current.analyticsChartOption as {
    series: Array<{ name: string; stack: string; data: number[] }>;
  };
}

describe("contribution mode", () => {
  it("gives each team its own stack that fills to 100%", () => {
    const { series } = renderContributionOption();

    expect(series.map((s) => [s.name, s.stack, s.data[0]])).toEqual([
      ["Alpha · Ann", "Alpha", 90],
      ["Alpha · Ben", "Alpha", 10],
      ["Bravo · Cai", "Bravo", 50],
      ["Bravo · Dee", "Bravo", 50],
    ]);

    // Each team's bar is complete on its own. The single shared stack this
    // replaced divided by the combined 1010 total, so Bravo's halves rendered
    // as 0.5% each and the two teams were indistinguishable.
    for (const stack of ["Alpha", "Bravo"]) {
      const total = series
        .filter((s) => s.stack === stack)
        .reduce((sum, s) => sum + (s.data[0] ?? 0), 0);
      expect(total).toBe(100);
    }
  });

  it("charts only the selected teams", () => {
    const { series } = renderContributionOption(["Bravo"]);

    expect(series.map((s) => s.stack)).toEqual(["Bravo", "Bravo"]);
    expect(series.reduce((sum, s) => sum + (s.data[0] ?? 0), 0)).toBe(100);
  });
});
