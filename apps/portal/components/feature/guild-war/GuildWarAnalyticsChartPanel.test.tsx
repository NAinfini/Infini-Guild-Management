import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@portal/stores/preferences";
import { GuildWarAnalyticsChartPanel } from "./GuildWarAnalyticsChartPanel";

describe("GuildWarAnalyticsChartPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
  });

  it.each(["player", "radar"])("updates %s animation policy and releases the prior chart when motion changes", (mode) => {
    const chartProps = vi.fn();
    const releaseChart = vi.fn();
    function Chart(props: Record<string, unknown>) {
      chartProps(props);
      useEffect(() => releaseChart, []);
      return <div data-testid="analytics-chart" />;
    }
    const chartOption = { series: [{ type: "line", name: "Damage", data: [1, 3] }] };
    const radarOption = { series: [{ type: "radar", data: [{ value: [1, 3] }] }] };
    const sourceOption = mode === "radar" ? radarOption : chartOption;
    usePreferencesStore.getState().setMotionPreference("reduce");
    render(
      <GuildWarAnalyticsChartPanel
        ReactEChartsCore={Chart as never}
        echarts={{}}
        themeName="guild-light"
        chartOption={chartOption}
        radarOption={radarOption}
        mode={mode}
        selectedUsers={["user-1"]}
        selectedMetrics={["damage"]}
        expanded={false}
        onToggleExpanded={vi.fn()}
        heading={{ kicker: "Player", title: "Damage" }}
        t={(key) => key}
      />,
    );
    expect(chartProps.mock.lastCall?.[0].option).toEqual({ ...sourceOption, animation: false });
    expect(releaseChart).not.toHaveBeenCalled();

    act(() => usePreferencesStore.getState().setMotionPreference("system"));
    expect(chartProps.mock.lastCall?.[0].option).toEqual({ ...sourceOption, animation: true });
    expect(releaseChart).toHaveBeenCalledTimes(1);

    act(() => usePreferencesStore.getState().setMotionPreference("reduce"));
    expect(chartProps.mock.lastCall?.[0].option).toEqual({ ...sourceOption, animation: false });
    expect(releaseChart).toHaveBeenCalledTimes(2);
    expect(sourceOption).not.toHaveProperty("animation");
  });

  it("replaces a blank chart with an actionable localized empty state", () => {
    const onAction = vi.fn();
    const Chart = vi.fn(() => <div data-testid="analytics-chart" />);

    render(
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
        />,
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
            // Normalization rewrites every plotted number, so the header must disclose it.
            note: "Values normalised to a 30-minute baseline",
          }}
          t={(key) => key}
        />,
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
        />,
    );

    // Merging kept the previous mode's series alive: the war mode's 敌方/差额
    // leaked into rankings, and raw team totals survived into contribution mode
    // where the new "{v}%" formatter rendered 522000 damage as "522000%".
    expect(Chart.mock.calls[0]?.[0]).toMatchObject({ notMerge: true });
  });

  it("renders the real result sequence beside a war comparison chart", () => {
    const Chart = vi.fn(() => <div data-testid="analytics-chart" />);

    render(
      <GuildWarAnalyticsChartPanel
        ReactEChartsCore={Chart as never}
        echarts={{}}
        themeName="guild-light"
        chartOption={{}}
        radarOption={null}
        mode="wars"
        selectedUsers={[]}
        selectedMetrics={[]}
        expanded={false}
        onToggleExpanded={vi.fn()}
        heading={{ kicker: "Wars", title: "War comparison · 2 wars" }}
        warOutcomes={[
          { id: "war-1", label: "Crimson Tide", result: "win", resultLabel: "Victory" },
          { id: "war-2", label: "Iron Vanguard", result: "loss", resultLabel: "Defeat" },
        ]}
        t={(key) => key}
      />,
    );

    const timeline = screen.getByRole("list", { name: "analytics.wars.timeline" });
    expect(timeline.querySelector('[data-result="win"]')).toHaveTextContent("VictoryCrimson Tide");
    expect(timeline.querySelector('[data-result="loss"]')).toHaveTextContent("DefeatIron Vanguard");
  });
});
