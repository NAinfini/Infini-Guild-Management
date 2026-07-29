// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import type { HistoryDetailData, HistorySummaryRow } from "../../types/guild-war";
import {
  toDraftMetricValue,
  useWarHistoryTabController,
} from "./useWarHistoryTabController";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      key === "history.aria.memberMetric"
        ? `${options?.member} — ${options?.metric}`
        : key,
  }),
}));

function historyRow(id: string): HistorySummaryRow {
  return {
    id,
    war_name: `War ${id}`,
    enemy_name: null,
    result: "win",
    created_at: "2026-07-28T00:00:00.000Z",
    own_stats: null,
    enemy_stats: null,
  };
}

describe("toDraftMetricValue", () => {
  it("preserves decimal metrics", () => {
    expect(toDraftMetricValue(1234.56)).toBe(1234.56);
    expect(toDraftMetricValue("1234.56")).toBe(1234.56);
  });

  it("keeps invalid and negative draft metrics at zero", () => {
    expect(toDraftMetricValue("not-a-number")).toBe(0);
    expect(toDraftMetricValue(-1)).toBe(0);
  });
});

describe("history selection", () => {
  it("preserves selections when the user changes pages", async () => {
    const { result, rerender } = renderHook(
      ({ page, rows }: { page: number; rows: HistorySummaryRow[] }) =>
        useWarHistoryTabController({
          historySearch: "",
          onHistorySearchChange: vi.fn(),
          historyRows: rows,
          historyPage: page,
          historyPerPage: 20,
          historyColumns: [],
          historyDetail: null,
          canManage: true,
          saveMemberStatsPending: false,
          onSelectHistoryId: vi.fn(),
          onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
          onDeleteHistory: vi.fn(),
          onBulkDeleteHistory: vi.fn(),
        }),
      {
        initialProps: {
          page: 1,
          rows: [historyRow("war-1")],
        },
      },
    );

    act(() => result.current.toggleHistorySelection("war-1"));
    rerender({ page: 2, rows: [historyRow("war-2")] });

    await waitFor(() => {
      expect(result.current.selectedHistoryIds).toEqual(new Set(["war-1"]));
    });
  });

  it("selects or clears only the current page", () => {
    const { result, rerender } = renderHook(
      ({ page, rows }: { page: number; rows: HistorySummaryRow[] }) =>
        useWarHistoryTabController({
          historySearch: "",
          onHistorySearchChange: vi.fn(),
          historyRows: rows,
          historyPage: page,
          historyPerPage: 20,
          historyColumns: [],
          historyDetail: null,
          canManage: true,
          saveMemberStatsPending: false,
          onSelectHistoryId: vi.fn(),
          onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
          onDeleteHistory: vi.fn(),
          onBulkDeleteHistory: vi.fn(),
        }),
      {
        initialProps: {
          page: 1,
          rows: [historyRow("war-1")],
        },
      },
    );

    act(() => result.current.toggleHistorySelection("war-1"));
    rerender({ page: 2, rows: [historyRow("war-2"), historyRow("war-3")] });
    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedHistoryIds).toEqual(new Set(["war-1", "war-2", "war-3"]));

    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedHistoryIds).toEqual(new Set(["war-1"]));
  });
});

describe("history metric editing", () => {
  it("renders inputs immediately and keeps vertical navigation aligned after sorting", async () => {
    const user = userEvent.setup();
    const historyDetail: HistoryDetailData = {
      id: "war-1",
      war_name: "War 1",
      enemy_name: "Rivals",
      result: "win",
      own_stats: null,
      enemy_stats: null,
      notes: null,
      teams: [],
      member_stats: [
        {
          id: "stat-1",
          user_id: "user-1",
          username: "Alice",
          role_tag: null,
          stats: { kills: 3, damage: 1234.56 },
        },
        {
          id: "stat-2",
          user_id: "user-2",
          username: "Bob",
          role_tag: null,
          stats: { kills: 8, damage: 900 },
        },
      ],
    };

    const { result } = renderHook(() =>
      useWarHistoryTabController({
        historySearch: "",
        onHistorySearchChange: vi.fn(),
        historyRows: [historyRow("war-1")],
        historyPage: 1,
        historyPerPage: 20,
        historyColumns: [],
        historyDetail,
        canManage: true,
        saveMemberStatsPending: false,
        onSelectHistoryId: vi.fn(),
        onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
        onDeleteHistory: vi.fn(),
        onBulkDeleteHistory: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSelectHistoryId("war-1");
    });
    await waitFor(() => expect(result.current.detailModalOpen).toBe(true));
    act(() => {
      result.current.detailTable.getColumn("kills")?.toggleSorting(true);
    });
    await waitFor(() => {
      expect(result.current.detailTable.getState().sorting).toEqual([
        { id: "kills", desc: true },
      ]);
    });

    render(
      <MantineProvider>
        <DataTableAdapter table={result.current.detailTable} />
      </MantineProvider>,
    );

    const metricInputs = screen.getAllByLabelText(/ — history\.table\./);
    const bobKills = screen.getByLabelText("Bob — history.table.kills");
    const aliceKills = screen.getByLabelText("Alice — history.table.kills");
    const aliceDamage = screen.getByLabelText("Alice — history.table.damage");

    expect(metricInputs).toHaveLength(16);
    expect(bobKills).toHaveAttribute("data-metric-grid", "guild-war-history-metrics");
    expect(bobKills).toHaveAttribute("data-grid-row", "0");
    expect(aliceKills).toHaveAttribute("data-grid-row", "1");
    expect(aliceDamage).toHaveValue("1234.56");

    await user.click(bobKills);
    await user.keyboard("{ArrowDown}");
    expect(aliceKills).toHaveFocus();
  });
});
