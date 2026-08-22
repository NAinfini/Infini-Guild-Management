import { Badge, HoverCard, MantineProvider } from "@mantine/core";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useMemo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryDetailData, HistoryMemberStat } from "@portal/types/guild-war";
import { WarHistoryDetail } from "./WarHistoryDetail";

const AVATAR_MEDIA_ID = "avatar1234567890abcde";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("echarts-for-react/esm/core", () => ({
  default: () => <div data-testid="history-chart" />,
}));

function setMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
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
};

function HistoryDetailHarness({
  onBackToList,
  onExport = vi.fn(),
  canManage = false,
}: HistoryDetailHarnessProps) {
  const memberRows = useMemo<HistoryMemberStat[]>(() => [{
    id: "member-stat-1",
    user_id: "user-1",
    username: "Lyra",
    role_tag: "core",
    stats: { damage: 4120 },
  }], []);
  const columns = useMemo<ColumnDef<HistoryMemberStat, unknown>[]>(() => [
    {
      accessorKey: "user_id",
      header: "Member",
      cell: ({ row }) => row.original.username ?? row.original.user_id,
    },
    {
      id: "damage",
      header: "Damage",
      accessorFn: (row) => row.stats?.damage ?? 0,
      cell: ({ row }) => (
        <input
          type="number"
          aria-label={`Damage for ${row.original.username ?? row.original.user_id}`}
          defaultValue={row.original.stats?.damage ?? 0}
        />
      ),
    },
    {
      id: "missing",
      header: "Status",
      cell: () => (
        <HoverCard width={200}>
          <HoverCard.Target>
            <Badge component="button" type="button">Complete</Badge>
          </HoverCard.Target>
          <HoverCard.Dropdown>Status detail</HoverCard.Dropdown>
        </HoverCard>
      ),
    },
  ], []);
  const detailTable = useReactTable({
    data: memberRows,
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
    member_stats: memberRows,
    teams: [{
      id: "team-1",
      team_name: "Alpha",
      notes: null,
      members: [{
        user_id: "user-1",
        username: "Lyra",
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
      historyViewMode="table"
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
    setMobileViewport(false);
  });

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
    expect(screen.getByRole("heading", { level: 2, name: "Iron Siege" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Iron Siege" })).not.toBeInTheDocument();

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
    expect(board).toHaveClass("whd-board--win");
    expect(board).toHaveTextContent("35");
    expect(board).toHaveTextContent("28");
    expect(board).toHaveTextContent("Kills");
    expect(board.querySelector(".whd-board__metric-icon")).not.toBeNull();
  });

  it("uses semantic icons to make the history summary easier to scan", () => {
    const { container } = render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={vi.fn()} />
      </MantineProvider>,
    );

    expect(container.querySelectorAll(".whd-strip__cell[data-metric]")).toHaveLength(5);
    expect(container.querySelectorAll(".whd-strip__icon")).toHaveLength(5);
    expect(container.querySelectorAll(".whd-identity__meta-item .whd-identity__meta-icon")).toHaveLength(2);
    expect(container.querySelectorAll(".whd-section-title__icon")).toHaveLength(2);
    expect(container.querySelectorAll(".whd-view-option__icon")).toHaveLength(2);
    expect(container.querySelectorAll(".whd-export-icon")).toHaveLength(2);
  });

  it("shows each member avatar in the team snapshot", () => {
    render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={vi.fn()} />
      </MantineProvider>,
    );

    const memberChip = document.querySelector(".whd-chip");
    expect(memberChip).not.toBeNull();
    expect(memberChip?.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining(`/api/media/${AVATAR_MEDIA_ID}/view`),
    );
  });

  it("renders the TanStack row model as scan-friendly member cards on mobile", async () => {
    setMobileViewport(true);

    render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={vi.fn()} />
      </MantineProvider>,
    );

    const card = await screen.findByTestId("war-history-member-card-user-1");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(card).getByText("Member")).toBeInTheDocument();
    expect(within(card).getByText("Lyra")).toBeInTheDocument();
    expect(within(card).getByText("Damage")).toBeInTheDocument();
    expect(within(card).getByRole("spinbutton", { name: "Damage for Lyra" })).toHaveValue(4120);
    const statusTrigger = within(card).getByRole("button", { name: "Complete" });
    expect(statusTrigger.tagName).toBe("BUTTON");
    expect(statusTrigger).toHaveAttribute("type", "button");
    expect(card.querySelector("div[aria-expanded]")).not.toBeInTheDocument();
  });

  it("keeps both history status hover-card triggers as real buttons", () => {
    const controllerSource = readFileSync(
      resolve(process.cwd(), "apps/portal/hooks/guild-war/useWarHistoryTabController.tsx"),
      "utf8",
    );
    const statusTargets = [...controllerSource.matchAll(
      /<HoverCard\.Target>([\s\S]*?)<\/HoverCard\.Target>/g,
    )]
      .map((match) => match[1] ?? "")
      .filter((target) => target.includes("history.table.complete") || target.includes("history.table.missing"));

    expect(statusTargets).toHaveLength(2);
    for (const target of statusTargets) {
      expect(target).toMatch(/<Badge[^>]*component="button"[^>]*type="button"/);
    }
  });

  it("uses a compact two-column field grid for mobile member cards", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/GuildWarPage.css"),
      "utf8",
    );
    const mobileStyles = styles.slice(styles.lastIndexOf("@media (max-width: 767px)"));

    expect(mobileStyles).toMatch(
      /\.whd-member-card__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(mobileStyles).toMatch(
      /\.whd-member-card__field\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*padding-block:\s*var\(--space-xs\)/,
    );
    expect(mobileStyles).toMatch(
      /\.whd-member-card__value\s*\{[^}]*justify-content:\s*flex-start/,
    );
  });

  it("keeps exports beside the current record identity with record-specific accessible names", async () => {
    const onExport = vi.fn();
    const { container } = render(
      <MantineProvider>
        <HistoryDetailHarness onBackToList={vi.fn()} onExport={onExport} canManage />
      </MantineProvider>,
    );

    const identityExports = container.querySelector(".whd-identity__exports");
    const footer = container.querySelector(".whd-actions");
    expect(identityExports).not.toBeNull();
    expect(footer).not.toBeNull();

    const csv = within(identityExports as HTMLElement).getByRole("button", {
      name: "Export CSV: Iron Siege",
    });
    const json = within(identityExports as HTMLElement).getByRole("button", {
      name: "Export JSON: Iron Siege",
    });
    expect(footer).not.toContainElement(csv);
    expect(footer).not.toContainElement(json);

    await userEvent.click(csv);
    await userEvent.click(json);
    expect(onExport).toHaveBeenNthCalledWith(1, "csv");
    expect(onExport).toHaveBeenNthCalledWith(2, "json");
  });
});
