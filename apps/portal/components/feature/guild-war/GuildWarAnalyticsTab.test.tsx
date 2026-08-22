import { MantineProvider } from "@mantine/core";
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
    referenceDuration: 30,
    analyticsWarOptions: [{ value: "war-1", label: "War 1" }],
    analyticsSelectableUserIds: selectableUserIds,
    analyticsUserIdToUsername: new Map(selectableUserIds.map((id) => [id, id])),
    analyticsTeamOptions: [],
    analyticsMetricLabel: vi.fn(),
    analyticsWarSummary: { counts: new Map(), winRate: null },
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

function renderAnalyticsTab(analytics: GuildWarAnalyticsController) {
  return render(
    <MantineProvider>
      <GuildWarAnalyticsTab
        analytics={analytics}
        chartThemeName="test-theme"
        chartThemeConfig={buildEChartsTheme("light")}
        loadErrorMessage="load error"
        canManageWeights={false}
      />
    </MantineProvider>,
  );
}

describe("GuildWarAnalyticsTab", () => {
  beforeEach(() => {
    listBoxCalls.calls.length = 0;
  });

  it("allows player selection through the 20-member service hard cap", async () => {
    const applyAnalyticsSelection = vi.fn();
    renderAnalyticsTab(createAnalytics({ applyAnalyticsSelection }));

    // Console fields start collapsed, and Mantine's Collapse marks closed
    // content aria-hidden/inert, so the list box only enters the accessibility
    // tree once its row is opened (one animation frame later).
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

  it("puts every control on one console rail instead of two facing sidebars", () => {
    const { container } = renderAnalyticsTab(createAnalytics());

    expect(container.querySelectorAll(".gwa-console")).toHaveLength(1);
    // All selection dimensions belong to the same console rail.
    const rail = container.querySelector(".gwa-console")!;
    ["analytics.aria.selectWars", "analytics.aria.selectMembers", "analytics.aria.selectMetrics"]
      .forEach((label) => {
        expect(rail.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
      });
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
});
