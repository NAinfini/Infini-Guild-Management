// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WAR_MEMBER_STAT_KEYS } from "@guild/shared";
import { DataTableAdapter } from "@portal/components/shared/DataTableAdapter";
import type { HistoryDetailData, HistorySummaryRow } from "../../types/guild-war";
import {
  toDraftMetricValue,
  useWarHistoryTabController,
} from "./useWarHistoryTabController";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === "history.aria.memberMetric") {
        return `${options?.member} — ${options?.metric}`;
      }
      if (key === "history.aria.selectRecord") {
        return `${key} ${options?.name}`;
      }
      return key;
    },
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
  it("follows the page when the active record is no longer on it", async () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: HistorySummaryRow[] }) =>
        useWarHistoryTabController({
          historySearch: "",
          onHistorySearchChange: vi.fn(),
          historyRows: rows,
          historyPage: 1,
          historyPerPage: 20,
          historyDetail: null,
          canManage: true,
          saveMemberStatsPending: false,
          onSelectHistoryId: vi.fn(),
          onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
          onDeleteHistory: vi.fn(),
        }),
      { initialProps: { rows: [historyRow("war-1")] } },
    );

    await waitFor(() => expect(result.current.activeHistoryId).toBe("war-1"));
    rerender({ rows: [historyRow("war-2"), historyRow("war-3")] });
    await waitFor(() => expect(result.current.activeHistoryId).toBe("war-2"));
  });

  it("opens the first record on mount so the detail pane is never empty", async () => {
    const onSelectHistoryId = vi.fn();
    const { result } = renderHook(() =>
      useWarHistoryTabController({
        historySearch: "",
        onHistorySearchChange: vi.fn(),
        historyRows: [historyRow("war-1"), historyRow("war-2")],
        historyPage: 1,
        historyPerPage: 20,
        historyDetail: null,
        canManage: true,
        saveMemberStatsPending: false,
        onSelectHistoryId,
        onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
        onDeleteHistory: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.activeHistoryId).toBe("war-1"));
    expect(onSelectHistoryId).toHaveBeenCalledWith("war-1");
    // Auto-selecting must not drag the single-column layout into the detail
    // pane — mobile still starts on the list.
    expect(result.current.mobileView).toBe("list");
  });

  it("keeps the selection when the single-column layout returns to the list", async () => {
    const { result } = renderHook(() =>
      useWarHistoryTabController({
        historySearch: "",
        onHistorySearchChange: vi.fn(),
        historyRows: [historyRow("war-1"), historyRow("war-2")],
        historyPage: 1,
        historyPerPage: 20,
        historyDetail: null,
        canManage: true,
        saveMemberStatsPending: false,
        onSelectHistoryId: vi.fn(),
        onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
        onDeleteHistory: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSelectHistoryId("war-2");
    });
    expect(result.current.mobileView).toBe("detail");

    await act(async () => {
      await result.current.showMobileList();
    });
    expect(result.current.mobileView).toBe("list");
    expect(result.current.activeHistoryId).toBe("war-2");
  });
});

describe("history metric editing", () => {
  it("renders inputs only in edit mode and keeps vertical navigation aligned after sorting", async () => {
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
        historyDetail,
        canManage: true,
        saveMemberStatsPending: false,
        onSelectHistoryId: vi.fn(),
        onSaveMemberStats: vi.fn().mockResolvedValue(undefined),
        onDeleteHistory: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSelectHistoryId("war-1");
    });
    await waitFor(() => expect(result.current.activeHistoryId).toBe("war-1"));
    act(() => {
      result.current.detailTable.getColumn("kills")?.toggleSorting(true);
    });
    await waitFor(() => {
      expect(result.current.detailTable.getState().sorting).toEqual([
        { id: "kills", desc: true },
      ]);
    });

    /* 只读态下这些格子是纯文本；点过「编辑」才换成输入框。 */
    const readOnlyRender = render(
      <MantineProvider>
        <DataTableAdapter table={result.current.detailTable} />
      </MantineProvider>,
    );
    expect(screen.queryAllByLabelText(/^(Alice|Bob) — /)).toHaveLength(0);
    readOnlyRender.unmount();

    act(() => {
      result.current.beginEditMemberStats();
    });

    render(
      <MantineProvider>
        <DataTableAdapter table={result.current.detailTable} />
      </MantineProvider>,
    );

    const metricInputs = screen.getAllByLabelText(/^(Alice|Bob) — /);
    const bobKills = screen.getByLabelText("Bob — Kills");
    const aliceKills = screen.getByLabelText("Alice — Kills");
    const aliceDamage = screen.getByLabelText("Alice — Damage");

    expect(metricInputs).toHaveLength(16);
    expect(bobKills).toHaveAttribute("data-metric-grid", "guild-war-history-metrics");
    expect(bobKills).toHaveAttribute("data-grid-row", "0");
    expect(aliceKills).toHaveAttribute("data-grid-row", "1");
    expect(aliceDamage).toHaveValue("1234.56");

    await user.click(bobKills);
    await user.keyboard("{ArrowDown}");
    expect(aliceKills).toHaveFocus();
  });

  it("sends every editable metric, not just the one that changed", async () => {
    const user = userEvent.setup();
    const onSaveMemberStats = vi.fn().mockResolvedValue(undefined);
    const historyDetail: HistoryDetailData = {
      id: "war-1",
      war_name: "War 1",
      enemy_name: null,
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
          stats: { kills: 3, deaths: 2, assists: 1 },
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
        historyDetail,
        canManage: true,
        saveMemberStatsPending: false,
        onSelectHistoryId: vi.fn(),
        onSaveMemberStats,
        onDeleteHistory: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSelectHistoryId("war-1");
    });
    act(() => {
      result.current.beginEditMemberStats();
    });

    render(
      <MantineProvider>
        <DataTableAdapter table={result.current.detailTable} />
      </MantineProvider>,
    );

    const kills = screen.getByLabelText("Alice — Kills");
    await user.clear(kills);
    await user.type(kills, "9");

    await act(async () => {
      await result.current.handleSaveMemberStats();
    });

    /* member-stats 接口对 stats 是整列覆盖，只送改过的那一项会把其余指标清空。
       所以这里断言送出去的是完整的一份草稿——少一个 key 就是一次静默的数据丢失。 */
    const expectedPayload: Record<string, number> = Object.fromEntries(
      WAR_MEMBER_STAT_KEYS.map((key) => [key, 0]),
    );
    expectedPayload.kills = 9;
    expectedPayload.deaths = 2;
    expectedPayload.assists = 1;

    expect(onSaveMemberStats).toHaveBeenCalledTimes(1);
    expect(onSaveMemberStats.mock.calls[0]![0]).toEqual([
      { userId: "user-1", payload: expectedPayload },
    ]);
  });
});
