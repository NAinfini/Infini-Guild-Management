import type { Event } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuildWarData } from "./useGuildWarData";

const mocks = vi.hoisted(() => ({
  fetchEventsList: vi.fn(),
  fetchGuildWarActive: vi.fn(),
  fetchGuildWarConcludedEventIds: vi.fn(),
  fetchGuildWarHistory: vi.fn(),
  fetchGuildWarHistoryDetail: vi.fn(),
}));

vi.mock("../../services/EventService", () => ({
  fetchEventsList: mocks.fetchEventsList,
}));

vi.mock("../../services/GuildWarService", () => ({
  fetchGuildWarActive: mocks.fetchGuildWarActive,
  fetchGuildWarConcludedEventIds: mocks.fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory: mocks.fetchGuildWarHistory,
  fetchGuildWarHistoryDetail: mocks.fetchGuildWarHistoryDetail,
}));

function event(id: string, archivedAt: string | null): Event {
  return {
    id,
    type: "guild_war",
    title: id,
    description: null,
    start_at: "2026-07-01T20:00:00.000Z",
    end_at: "2026-07-01T21:00:00.000Z",
    capacity: null,
    pinned: false,
    signup_locked: false,
    auto_archive: true,
    auto_archived: Boolean(archivedAt),
    visible_at: null,
    archived_at: archivedAt,
    created_by: "admin-1",
    updated_by: null,
    attachments: [],
    class_quotas: [],
    series_id: null,
    instance_date: null,
    poll: null,
    winner_count: null,
    raffle_winners: [],
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

const archivedEvent = event("archived-war", "2026-07-02T00:00:00.000Z");
const liveEvent = event("live-war", null);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderData(selectedEventId: string | undefined, tab: "active" | "history" | "analytics" = "active") {
  return renderHook(
    () => useGuildWarData({
      tab,
      selectedEventId,
      selectedHistoryId: null,
      historyDateFrom: "",
      historyDateTo: "",
      historySearch: "",
      historyPage: 1,
      historyPerPage: 20,
    }),
    { wrapper: createWrapper() },
  );
}

describe("useGuildWarData active event eligibility", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.fetchEventsList.mockResolvedValue({
      data: [archivedEvent, liveEvent],
      total: 2,
      page: 1,
      limit: 100,
      total_pages: 1,
    });
    mocks.fetchGuildWarConcludedEventIds.mockResolvedValue({ data: [] });
    mocks.fetchGuildWarHistory.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      total_pages: 0,
    });
    mocks.fetchGuildWarActive.mockResolvedValue({
      event: archivedEvent,
      teams: [],
      pool: [],
      war_history: null,
    });
  });

  it("excludes an archived persisted selection before active-war queries run", async () => {
    const { result } = renderData("archived-war");

    await waitFor(() => {
      expect(result.current.warEventsQuery.isSuccess).toBe(true);
      expect(result.current.concludedEventIdsQuery.isSuccess).toBe(true);
    });

    expect(mocks.fetchEventsList).toHaveBeenCalledWith(expect.objectContaining({
      type: "guild_war",
      archived: false,
    }));
    expect(result.current.eligibleWarEvents.map((item) => item.id)).toEqual(["live-war"]);
    expect(result.current.activeSelectedEventId).toBeUndefined();
    expect(mocks.fetchGuildWarActive).not.toHaveBeenCalled();
  });

  it("allows active non-concluded events through to the active query", async () => {
    mocks.fetchGuildWarActive.mockResolvedValue({
      event: liveEvent,
      teams: [],
      pool: [],
      war_history: null,
    });

    const { result } = renderData("live-war");

    await waitFor(() => {
      expect(result.current.activeSelectedEventId).toBe("live-war");
      expect(mocks.fetchGuildWarActive).toHaveBeenCalledWith("live-war");
    });
  });

  it("does not expose the previous history result after filters change", async () => {
    let resolveFilteredHistory!: (value: {
      data: [];
      total: number;
      page: number;
      limit: number;
      total_pages: number;
    }) => void;
    mocks.fetchGuildWarHistory
      .mockResolvedValueOnce({
        data: [{
          id: "history-old",
          war_name: "Old war",
          enemy_name: null,
          result: "win",
          created_at: "2026-07-01T00:00:00.000Z",
          own_stats: null,
          enemy_stats: null,
        }],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFilteredHistory = resolve;
      }));
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) => useGuildWarData({
        tab: "history",
        selectedEventId: undefined,
        selectedHistoryId: null,
        historyDateFrom: "",
        historyDateTo: "",
        historySearch: search,
        historyPage: 1,
        historyPerPage: 20,
      }),
      { initialProps: { search: "" }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.historyQuery.data?.data[0]?.id).toBe("history-old"));
    rerender({ search: "new war" });

    expect(result.current.historyQuery.data).toBeUndefined();
    expect(result.current.historyQuery.isLoading).toBe(true);

    resolveFilteredHistory({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });
    await waitFor(() => expect(result.current.historyQuery.isSuccess).toBe(true));
  });

  it("loads only the history data needed by the current tab", async () => {
    mocks.fetchGuildWarHistoryDetail.mockResolvedValue({ id: "history-1" });
    const { result } = renderHook(
      () => useGuildWarData({
        tab: "history",
        selectedEventId: "live-war",
        selectedHistoryId: "history-1",
        historyDateFrom: "",
        historyDateTo: "",
        historySearch: "",
        historyPage: 1,
        historyPerPage: 20,
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.historyQuery.isSuccess).toBe(true);
      expect(result.current.historyDetailQuery.isSuccess).toBe(true);
    });

    expect(mocks.fetchEventsList).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarConcludedEventIds).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarActive).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarHistoryDetail).toHaveBeenCalledWith("history-1");
  });

  it("does not load a history detail for analytics", async () => {
    const { result } = renderHook(
      () => useGuildWarData({
        tab: "analytics",
        selectedEventId: "live-war",
        selectedHistoryId: "history-1",
        historyDateFrom: "",
        historyDateTo: "",
        historySearch: "",
        historyPage: 1,
        historyPerPage: 20,
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.historyQuery.isSuccess).toBe(true));

    expect(mocks.fetchEventsList).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarConcludedEventIds).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarActive).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarHistoryDetail).not.toHaveBeenCalled();
  });
});
