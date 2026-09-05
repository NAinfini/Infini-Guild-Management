import { Button } from "@portal/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useTable } from "@tanstack/react-table";
import {
  dataTableFeatures,
  type DataTableColumnDef,
} from "@portal/components/shared/data-table-features";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryDetailData, HistoryMemberStat, HistoryViewMode } from "@portal/types/guild-war";
import { usePreferencesStore } from "@portal/stores/preferences";
import { WarHistoryDetail } from "./WarHistoryDetail";

const AVATAR_MEDIA_ID = "avatar1234567890abcde";
const { chartProps } = vi.hoisted(() => ({ chartProps: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("echarts-for-react/esm/core", () => ({
  default: (props: Record<string, unknown>) => {
    chartProps(props);
    return <div data-testid="history-chart" />;
  },
}));

function setMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" && matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

type HistoryDetailHarnessProps = {
  onBackToList: () => void;
  onExport?: (format: "csv" | "json") => void;
  canManage?: boolean;
  historyViewMode?: HistoryViewMode;
};

function HistoryDetailHarness({
  onBackToList,
  onExport = vi.fn(),
  canManage = false,
  historyViewMode = "table",
}: HistoryDetailHarnessProps) {
  const memberRows = useMemo<HistoryMemberStat[]>(() => [{
    id: "member-stat-1",
    user_id: "user-1",
    display_name: "Lyra",
    role_tag: "core",
    stats: { damage: 4120 },
  }], []);
  const columns = useMemo<DataTableColumnDef<HistoryMemberStat>[]>(() => [
    {
      accessorKey: "user_id",
      header: "Member",
      cell: ({ row }) => row.original.display_name ?? row.original.user_id,
    },
    {
      id: "damage",
      header: "Damage",
      accessorFn: (row) => row.stats?.damage ?? 0,
      cell: ({ row }) => (
        <input
          type="number"
          aria-label={`Damage for ${row.original.display_name ?? row.original.user_id}`}
          defaultValue={row.original.stats?.damage ?? 0}
        />
      ),
    },
    {
      id: "missing",
      header: "Status",
      cell: () => (
        <Tooltip>
          <TooltipTrigger render={<Button type="button" size="xs" variant="outline" />}>
            Complete
          </TooltipTrigger>
          <TooltipContent>Status detail</TooltipContent>
        </Tooltip>
      ),
    },
  ], []);
  const detailTable = useTable({
    features: dataTableFeatures,
    data: memberRows,
    columns,
    manualPagination: true,
  });
  const historyDetail: HistoryDetailData = {
    id: "history-1",
    etag: '"history-history-1-1"',
    war_name: "Iron Siege",
    enemy_name: "Storm Vanguard",
    result: "win",
    own_stats: { kills: 35, towers: 4, base_hp: 22, distance: 810, credits: 12400 },
    enemy_stats: { kills: 28, towers: 2, base_hp: 0, distance: 730, credits: 11100 },
    notes: null,
    member_stats: memberRows,
    teams: [{
      id: "team-1",
      team_name: "Alpha",
      notes: null,
      members: [{
        user_id: "user-1",
        display_name: "Lyra",
        avatar_media_id: AVATAR_MEDIA_ID,
        role_tag: "core",
      }],
    }],
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
      historyViewMode={historyViewMode}
      historyChartMetric="damage"
      detailTable={detailTable}
      canManage={canManage}
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
      onExport={onExport}
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
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
    chartProps.mockClear();
    setMobileViewport(false);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(20);
  });

  afterEach(() => vi.restoreAllMocks());

  it("disables initial and updated chart animations when reduced motion is requested", () => {
    usePreferencesStore.getState().setMotionPreference("reduce");
    render(<HistoryDetailHarness onBackToList={vi.fn()} historyViewMode="chart" />);
    const initialOption = chartProps.mock.lastCall?.[0].option;
    expect(initialOption.animation).toBe(false);

    act(() => usePreferencesStore.getState().setMotionPreference("system"));
    expect(chartProps.mock.lastCall?.[0].option).toEqual({ ...initialOption, animation: true });

    act(() => usePreferencesStore.getState().setMotionPreference("reduce"));
    expect(chartProps.mock.lastCall?.[0].option).toEqual(initialOption);
  });

  it("renders history detail inline instead of in a dialog and provides a list return action", async () => {
    const onBackToList = vi.fn();

    render(<HistoryDetailHarness onBackToList={onBackToList} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Iron Siege" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Iron Siege" })).not.toBeInTheDocument();

    // The back action is CSS-hidden on desktop, not unmounted — it stays in the
    // accessibility tree so the single-column layout can return to the list.
    await userEvent.click(screen.getByRole("button", { name: "history.backToList" }));
    expect(onBackToList).toHaveBeenCalledOnce();
  });

  it("shows the kills scoreboard for both sides with the metric label kept visible", () => {
    render(<HistoryDetailHarness onBackToList={vi.fn()} />);

    const board = screen.getByTestId("war-history-scoreboard");
    expect(board).toHaveTextContent("35");
    expect(board).toHaveTextContent("28");
    expect(board).toHaveTextContent("Kills");
  });

  it("renders the TanStack row model as scan-friendly member cards on mobile", async () => {
    setMobileViewport(true);

    render(<HistoryDetailHarness onBackToList={vi.fn()} />);

    const card = await screen.findByTestId("war-history-member-card-user-1");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(card).getByText("Member")).toBeInTheDocument();
    expect(within(card).getByText("Lyra")).toBeInTheDocument();
    expect(within(card).getByText("Damage")).toBeInTheDocument();
    expect(within(card).getByRole("spinbutton", { name: "Damage for Lyra" })).toHaveValue(4120);
    const statusTrigger = within(card).getByRole("button", { name: "Complete" });
    expect(statusTrigger).toHaveAttribute("type", "button");
  });

  it("keeps exports beside the current record identity with record-specific accessible names", async () => {
    const onExport = vi.fn();
    render(<HistoryDetailHarness onBackToList={vi.fn()} onExport={onExport} canManage />);

    const csv = screen.getByRole("button", {
      name: "Export CSV: Iron Siege",
    });
    const json = screen.getByRole("button", {
      name: "Export JSON: Iron Siege",
    });

    await userEvent.click(csv);
    await userEvent.click(json);
    expect(onExport).toHaveBeenNthCalledWith(1, "csv");
    expect(onExport).toHaveBeenNthCalledWith(2, "json");
  });
});
