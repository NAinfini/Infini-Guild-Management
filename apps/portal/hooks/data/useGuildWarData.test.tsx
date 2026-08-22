import type { Event } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuildWarData } from "./useGuildWarData";

const mocks = vi.hoisted(() => ({
  fetchEventsList: vi.fn(),
  fetchEventDetail: vi.fn(),
  fetchGuildWarActive: vi.fn(),
  fetchGuildWarConcludedEventIds: vi.fn(),
  fetchGuildWarHistory: vi.fn(),
  fetchGuildWarHistoryDetail: vi.fn(),
}));

vi.mock("../../services/EventService", () => ({
  fetchEventsList: mocks.fetchEventsList,
  fetchEventDetail: mocks.fetchEventDetail,
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

function renderData(selectedEventId: string | undefined) {
  return renderHook(
    () => useGuildWarData({
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
    mocks.fetchEventDetail.mockResolvedValue({
      ...archivedEvent,
      participants: [],
    });
    mocks.fetchGuildWarActive.mockResolvedValue({
      event: archivedEvent,
      teams: [],
      pool: [],
      war_history: null,
    });
  });

  it("excludes an archived persisted selection before detail or active-war queries run", async () => {
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
    expect(mocks.fetchEventDetail).not.toHaveBeenCalled();
    expect(mocks.fetchGuildWarActive).not.toHaveBeenCalled();
  });

  it("allows active non-concluded events through to the active query", async () => {
    mocks.fetchEventDetail.mockResolvedValue({
      ...liveEvent,
      participants: [],
    });
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
});
