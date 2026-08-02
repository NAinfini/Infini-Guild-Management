// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryDetailData, HistoryMemberStat } from "@portal/types/guild-war";
import { WarHistoryDetail } from "./WarHistoryDetail";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("echarts-for-react/esm/core", () => ({
  default: () => <div data-testid="history-chart" />,
}));

function HistoryDetailHarness({ onBackToList }: { onBackToList: () => void }) {
  const columns = useMemo<ColumnDef<HistoryMemberStat, unknown>[]>(() => [
    { accessorKey: "user_id", header: "Member" },
  ], []);
  const detailTable = useReactTable({
    data: [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const historyDetail: HistoryDetailData = {
    id: "history-1",
    war_name: "Iron Siege",
    enemy_name: "Storm Vanguard",
    result: "win",
    own_stats: { kills: 35, towers: 4, base_hp: 22, distance: 810, credits: 12400 },
    enemy_stats: { kills: 28, towers: 2, base_hp: 0, distance: 730, credits: 11100 },
    notes: null,
    member_stats: [],
    teams: [],
  };

  return (
    <WarHistoryDetail
      onBackToList={onBackToList}
      historyDetail={historyDetail}
      historyDetailTitle="History detail"
      historyDetailLoading={false}
      historyDetailError={false}
      loadErrorMessage="Load error"
      historyMvp={null}
      historyViewMode="table"
      historyChartMetric="damage"
      detailTable={detailTable}
      canManage={false}
      hasUnsavedMemberChanges={false}
      isEditingMemberStats={false}
      onBeginEditMemberStats={vi.fn()}
      onCancelEditMemberStats={vi.fn()}
      saveMemberStatsPending={false}
      deleteHistoryPending={false}
      exportPending={false}
      exportCsvLabel="Export CSV"
      exportJsonLabel="Export JSON"
      historyRows={[historyDetail]}
      onSaveMemberStats={vi.fn()}
      onDeleteHistory={vi.fn()}
      onExport={vi.fn()}
      onHistoryViewModeChange={vi.fn()}
      onHistoryChartMetricChange={vi.fn()}
      chartThemeName="guild-light"
      chartThemeConfig={{} as never}
      chartPalette={["var(--domain-war)"]}
      hashToPaletteColor={() => "var(--domain-war)"}
      getMetricLabel={(metric) => metric}
      metricValueOrNullFromWarMember={() => null}
    />
  );
}

describe("WarHistoryDetail", () => {
  it("renders history detail inline instead of in a dialog and provides a list return action", async () => {
    const onBackToList = vi.fn();

    render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={onBackToList} />
      </MantineProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("war-history-inline-detail").tagName).toBe("SECTION");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    // The back action is CSS-hidden on desktop, not unmounted — it stays in the
    // accessibility tree so the single-column layout can return to the list.
    await userEvent.click(screen.getByRole("button", { name: "history.backToList" }));
    expect(onBackToList).toHaveBeenCalledOnce();
  });

  it("shows the kills scoreboard for both sides with the metric label kept visible", () => {
    render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={vi.fn()} />
      </MantineProvider>,
    );

    const board = screen.getByTestId("war-history-scoreboard");
    expect(board).toHaveTextContent("35");
    expect(board).toHaveTextContent("28");
    expect(board).toHaveTextContent("history.kills");
  });
});
