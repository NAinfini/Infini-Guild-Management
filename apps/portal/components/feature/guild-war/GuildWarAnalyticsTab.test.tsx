import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuildWarAnalyticsController } from "@portal/hooks/guild-war/useGuildWarAnalytics";
import { buildEChartsTheme } from "@portal/theme/echarts";
import { GuildWarAnalyticsTab } from "./GuildWarAnalyticsTab";

const listBoxCalls = vi.hoisted(() => ({
  calls: [] as Array<{ ariaLabel?: string; maxSelect?: number }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("./GuildWarAnalyticsChartPanel", () => ({
  GuildWarAnalyticsChartPanel: () => <div data-testid="analytics-chart" />,
}));

vi.mock("./GuildWarAnalyticsListBox", () => ({
  GuildWarAnalyticsListBox: ({
    ariaLabel,
    items,
    maxSelect,
    onChange,
  }: {
    ariaLabel?: string;
    items: Array<{ value: string }>;
    maxSelect?: number;
    onChange: (values: string[]) => void;
  }) => {
    listBoxCalls.calls.push({ ariaLabel, maxSelect });
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        data-max-select={maxSelect}
        onClick={() => onChange(items.map((item) => item.value))}
      />
    );
  },
  UserListBoxItem: () => null,
}));

function createAnalytics(
  overrides: Partial<GuildWarAnalyticsController> = {},
): GuildWarAnalyticsController {
  const selectableUserIds = Array.from({ length: 21 }, (_, index) => `user-${index + 1}`);

  return {
    analyticsQuery: { isLoading: false, isFetching: false, isError: false },
    analyticsDetailsQuery: { isLoading: false, isFetching: false, isError: false },
    analyticsWarIds: ["war-1"],
    analyticsMode: "player",
    setAnalyticsMode: vi.fn(),
    analyticsSelectedMetrics: ["damage"],
    setAnalyticsSelectedMetrics: vi.fn(),
    analyticsOnlyParticipated: false,
    setAnalyticsOnlyParticipated: vi.fn(),
    analyticsDatePreset: "all",
    analyticsSelectedWarIds: [],
    setAnalyticsSelectedWarIds: vi.fn(),
    analyticsSelectedUsers: [],
    analyticsWarStat: "kills",
    setAnalyticsWarStat: vi.fn(),
    analyticsAggregation: "total",
    setAnalyticsAggregation: vi.fn(),
    analyticsMinParticipation: 1,
    setAnalyticsMinParticipation: vi.fn(),
    analyticsTopN: 10,
    setAnalyticsTopN: vi.fn(),
    analyticsSelectedTeams: [],
    setAnalyticsSelectedTeams: vi.fn(),
    analyticsTeamAggregation: "total",
    setAnalyticsTeamAggregation: vi.fn(),
    analyticsNormEnabled: false,
    setAnalyticsNormEnabled: vi.fn(),
    analyticsShowDeviation: false,
    setAnalyticsShowDeviation: vi.fn(),
    analyticsShowContribution: false,
    setAnalyticsShowContribution: vi.fn(),
    analyticsHeatmapEnabled: false,
    setAnalyticsHeatmapEnabled: vi.fn(),
    modifierWeights: {},
    setModifierWeights: vi.fn(),
    modifierWeightsDirty: false,
    modifierWeightsValid: true,
    saveModifierWeights: vi.fn(),
    saveModifierWeightsPending: false,
    referenceDuration: 30,
    analyticsWarOptions: [{ value: "war-1", label: "War 1" }],
    analyticsSelectableUserIds: selectableUserIds,
    analyticsUserIdToUsername: new Map(selectableUserIds.map((id) => [id, id])),
    analyticsUserIdToAvatarMediaId: new Map(),
    analyticsTeamOptions: [],
    analyticsMetricLabel: vi.fn(),
    analyticsWarSummary: { counts: new Map(), decided: 0, winRate: null },
    analyticsChartOption: {},
    analyticsRadarOption: null,
    analyticsTableRows: [],
    analyticsTableColumns: [{ key: "member", dataIndex: "member", title: "Member" }],
    analyticsTableHeatmapRanges: new Map(),
    applyAnalyticsSelection: vi.fn(),
    copyAnalyticsCsv: vi.fn(),
    handleAnalyticsDatePresetChange: vi.fn(),
    getNormalizedMetricValue: vi.fn(),
    getNormalizedMetricValueOrNull: vi.fn(),
    metricValueFromWarMember: vi.fn(),
    metricValueOrNullFromWarMember: vi.fn(),
    getMetricLabelKey: vi.fn(),
    hashToPaletteColor: vi.fn(),
    selectionSoftCap: 10,
    ...overrides,
  } as GuildWarAnalyticsController;
}

function renderAnalyticsTab(
  analytics: GuildWarAnalyticsController,
  onRetry = vi.fn(),
  canManageWeights = false,
) {
  return render(
    <GuildWarAnalyticsTab
      analytics={analytics}
      chartThemeName="test-theme"
      chartThemeConfig={buildEChartsTheme("light")}
      loadErrorMessage="load error"
      onRetry={onRetry}
      canManageWeights={canManageWeights}
    />,
  );
}

describe("GuildWarAnalyticsTab", () => {
  beforeEach(() => {
    listBoxCalls.calls.length = 0;
  });

  it("allows player selection through the 20-member service hard cap", async () => {
    const applyAnalyticsSelection = vi.fn();
    renderAnalyticsTab(createAnalytics({ applyAnalyticsSelection }));

    // Console fields start collapsed; their one active selector mounts only
    // after its row is opened.
    fireEvent.click(
      screen.getByRole("button", { name: /analytics\.console\.section\.members/ }),
    );
    const memberSelector = await screen.findByRole("button", {
      name: "analytics.aria.selectMembers",
    });
    expect(memberSelector).toHaveAttribute("data-max-select", "20");

    fireEvent.click(memberSelector);
    expect(applyAnalyticsSelection).toHaveBeenCalledWith(
      Array.from({ length: 21 }, (_, index) => `user-${index + 1}`),
    );
  });

  it("renders an error empty state with retry when analytics has no cached result", () => {
    const onRetry = vi.fn();
    renderAnalyticsTab(createAnalytics({
      analyticsQuery: { isLoading: false, isFetching: false, isError: true, data: undefined } as unknown as GuildWarAnalyticsController["analyticsQuery"],
      analyticsDetailsQuery: { isLoading: false, isFetching: false, isError: true, data: undefined } as unknown as GuildWarAnalyticsController["analyticsDetailsQuery"],
    }), onRetry);

    expect(screen.getByText("load error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps cached analytics visible and offers retry when refresh fails", () => {
    const onRetry = vi.fn();
    renderAnalyticsTab(createAnalytics({
      analyticsMode: "wars",
      analyticsTableRows: [{ key: "war-1" }],
      analyticsWarSummary: {
        counts: new Map([["win", 1]]),
        decided: 1,
        winRate: 100,
      },
      analyticsQuery: { isLoading: false, isFetching: false, isError: true, data: {} } as unknown as GuildWarAnalyticsController["analyticsQuery"],
      analyticsDetailsQuery: { isLoading: false, isFetching: false, isError: false, data: [] } as unknown as GuildWarAnalyticsController["analyticsDetailsQuery"],
    }), onRetry);

    expect(screen.getByTestId("analytics-chart")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("treats an empty team filter as all available teams", () => {
    renderAnalyticsTab(createAnalytics({
      analyticsMode: "teams",
      analyticsSelectedTeams: [],
      analyticsTeamOptions: ["Vanguard", "Support"],
    }));

    expect(screen.getAllByText("analytics.chart.subject.teams:2")).not.toHaveLength(0);
  });

  it("enters radar mode with enough metrics to form a readable chart", () => {
    const setAnalyticsMode = vi.fn();
    const setAnalyticsSelectedMetrics = vi.fn();
    renderAnalyticsTab(createAnalytics({
      analyticsSelectedMetrics: ["damage"],
      setAnalyticsMode,
      setAnalyticsSelectedMetrics,
    }));

    fireEvent.click(
      screen.getByRole("button", { name: "analytics.toolbar.mode.radar" }),
    );

    expect(setAnalyticsSelectedMetrics).toHaveBeenCalledOnce();
    expect(setAnalyticsSelectedMetrics.mock.calls[0]?.[0]).toHaveLength(5);
    expect(setAnalyticsMode).toHaveBeenCalledWith("radar");
  });

  it("renders every analytics table row without asking the reader to expand it", () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      key: `row-${index + 1}`,
      member: `Player ${index + 1}`,
    }));
    renderAnalyticsTab(createAnalytics({ analyticsTableRows: rows }));

    // The table is what people copy out to chat, so it is open on arrival; the
    // toggle only exists to reclaim height.
    expect(
      screen.getByRole("button", { name: "analytics.table.title:21" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Player 21")).toBeInTheDocument();
  });

  it("opens one console field at a time so the rail keeps a fixed height", () => {
    renderAnalyticsTab(createAnalytics());

    const warField = screen.getByRole("button", { name: /analytics\.toolbar\.warSet/ });
    const memberField = screen.getByRole("button", {
      name: /analytics\.console\.section\.members/,
    });

    // Everything starts closed: the whole query is readable as a few rows.
    expect(warField).toHaveAttribute("aria-expanded", "false");
    expect(memberField).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(warField);
    expect(warField).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(memberField);
    expect(memberField).toHaveAttribute("aria-expanded", "true");
    expect(warField).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(memberField);
    expect(memberField).toHaveAttribute("aria-expanded", "false");
  });

  it("saves edited normalization weights only for an authorized manager", () => {
    const saveModifierWeights = vi.fn();
    const modifierWeights = {
      kills: 0.31,
      towers: 0.1,
      base_hp: 0.15,
      credits: 0.29,
      distance: 0.15,
    };
    renderAnalyticsTab(createAnalytics({
      analyticsNormEnabled: true,
      modifierWeights,
      modifierWeightsDirty: true,
      modifierWeightsValid: true,
      saveModifierWeights,
    }), vi.fn(), true);

    fireEvent.click(screen.getByRole("button", { name: "analytics.normalization" }));
    const save = screen.getByRole("button", { name: "analytics.normalization.save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(saveModifierWeights).toHaveBeenCalledOnce();
  });

  it("explains and blocks an all-zero normalization weight set", () => {
    renderAnalyticsTab(createAnalytics({
      analyticsNormEnabled: true,
      modifierWeights: {
        kills: 0,
        towers: 0,
        base_hp: 0,
        credits: 0,
        distance: 0,
      },
      modifierWeightsDirty: true,
      modifierWeightsValid: false,
    }), vi.fn(), true);

    fireEvent.click(screen.getByRole("button", { name: "analytics.normalization" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "analytics.normalization.weightsRequired",
    );
    expect(
      screen.getByRole("button", { name: "analytics.normalization.save" }),
    ).toBeDisabled();
  });

});
