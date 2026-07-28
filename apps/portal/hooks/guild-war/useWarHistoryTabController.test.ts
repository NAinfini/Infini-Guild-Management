// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistorySummaryRow } from "../../types/guild-war";
import {
  toDraftMetricValue,
  useWarHistoryTabController,
} from "./useWarHistoryTabController";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
