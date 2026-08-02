// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuildWarAnalyticsChartPanel } from "./GuildWarAnalyticsChartPanel";

describe("GuildWarAnalyticsChartPanel", () => {
  it("replaces a blank chart with an actionable localized empty state", () => {
    const onAction = vi.fn();
    const Chart = vi.fn(() => <div data-testid="analytics-chart" />);

    render(
      <MantineProvider>
        <GuildWarAnalyticsChartPanel
          ReactEChartsCore={Chart as never}
          echarts={{}}
          themeName="guild-light"
          chartOption={{}}
          radarOption={null}
          mode="player"
          selectedUsers={[]}
          selectedMetrics={["damage"]}
          expanded={false}
          onToggleExpanded={vi.fn()}
          heading={{ kicker: "Player", title: "4 members · Damage · 10 wars" }}
          t={(key) => key}
          emptyState={{
            title: "Choose data to chart",
            description: "Select a member in the left panel.",
            actionLabel: "Select first member",
            onAction,
          }}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Choose data to chart")).toBeInTheDocument();
    expect(screen.getByText("Select a member in the left panel.")).toBeInTheDocument();
    expect(screen.queryByTestId("analytics-chart")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select first member" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("names the query in the header and flags an active processing step", () => {
    const Chart = vi.fn(() => <div data-testid="analytics-chart" />);

    render(
      <MantineProvider>
        <GuildWarAnalyticsChartPanel
          ReactEChartsCore={Chart as never}
          echarts={{}}
          themeName="guild-light"
          chartOption={{}}
          radarOption={null}
          mode="player"
          selectedUsers={["user-1"]}
          selectedMetrics={["damage"]}
          expanded={false}
          onToggleExpanded={vi.fn()}
          heading={{
            kicker: "Player",
            title: "4 members · Damage · 10 wars",
            // Normalization rewrites every plotted number, so the header has to
            // say so — it used to be silent.
            note: "Values normalised to a 30-minute baseline",
          }}
          t={(key) => key}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("4 members · Damage · 10 wars")).toBeInTheDocument();
    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(
      screen.getByText("Values normalised to a 30-minute baseline"),
    ).toBeInTheDocument();
  });

  it("replaces the chart option instead of merging it with the previous mode", () => {
    // Typed props: this test reads them back, so the mock has to declare them.
    const Chart = vi.fn((_props: Record<string, unknown>) => (
      <div data-testid="analytics-chart" />
    ));

    render(
      <MantineProvider>
        <GuildWarAnalyticsChartPanel
          ReactEChartsCore={Chart as never}
          echarts={{}}
          themeName="guild-light"
          chartOption={{ series: [{ name: "Alpha Team" }] }}
          radarOption={null}
          mode="teams"
          selectedUsers={[]}
          selectedMetrics={["damage"]}
          expanded={false}
          onToggleExpanded={vi.fn()}
          heading={{ kicker: "Teams", title: "2 teams · Damage · 5 wars" }}
          t={(key) => key}
        />
      </MantineProvider>,
    );

    // Merging kept the previous mode's series alive: the war mode's 敌方/差额
    // leaked into rankings, and raw team totals survived into contribution mode
    // where the new "{v}%" formatter rendered 522000 damage as "522000%".
    expect(Chart.mock.calls[0]?.[0]).toMatchObject({ notMerge: true });
  });
});
