import type { Event } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventsFiltering } from "./useEventsFiltering";

const mocks = vi.hoisted(() => ({
  routeSearch: {
    search: "Archived War Event #2",
    view: "cards",
  } as Record<string, unknown>,
  navigate: vi.fn(),
  fetchEventDetailBatch: vi.fn(),
  useEventsData: vi.fn(),
  useMemberDirectory: vi.fn(),
  useMemberAvailabilitySummary: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.routeSearch,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./data/useEventsData", () => ({
  useEventsData: mocks.useEventsData,
}));

vi.mock("./data/useMemberDirectory", () => ({
  useMemberDirectory: mocks.useMemberDirectory,
  useMemberAvailabilitySummary: mocks.useMemberAvailabilitySummary,
}));

vi.mock("../services/EventService", () => ({
  fetchEventDetailBatch: mocks.fetchEventDetailBatch,
}));

const archivedEvent = {
  id: "archived-event-2",
  type: "guild_war",
  title: "Archived War Event #2",
  description: "Archived event outside the active list",
  start_at: "2026-07-01T20:00:00.000Z",
  end_at: "2026-07-01T21:00:00.000Z",
  capacity: 20,
  pinned: false,
  signup_locked: true,
  auto_archive: true,
  auto_archived: true,
  visible_at: null,
  archived_at: "2026-07-02T00:00:00.000Z",
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
  updated_at: "2026-07-02T00:00:00.000Z",
} satisfies Event;

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

describe("useEventsFiltering list-only data", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.fetchEventDetailBatch.mockReset();
    mocks.useEventsData.mockReset();
    mocks.useMemberDirectory.mockReset();
    mocks.useMemberAvailabilitySummary.mockReset();
    mocks.routeSearch = {
      search: "Archived War Event #2",
      view: "cards",
    };

    mocks.fetchEventDetailBatch.mockResolvedValue({
      data: [{
        ...archivedEvent,
        participants: [{
          id: "participant-1",
          event_id: archivedEvent.id,
          user_id: "member-1",
          joined_at: "2026-06-25T00:00:00.000Z",
        }],
      }],
    });
    mocks.useEventsData.mockReturnValue({
      eventsQuery: { isError: false },
      eventsQueryData: [],
      eventsHasMore: false,
      eventsLoadingMore: false,
      onLoadMoreEvents: vi.fn(),
    });
    mocks.useMemberDirectory.mockReturnValue({
      entries: [{
        user: { id: "member-1", display_name: "Member One" },
        profile: { classes: [], power: 0, avatar_media_id: null },
      }],
      isError: false,
    });
    mocks.useMemberAvailabilitySummary.mockReturnValue({ data: undefined, isError: false });
  });

  it("uses batch preview data for the current list without owning a detail route", async () => {
    mocks.useEventsData.mockReturnValue({
      eventsQuery: { isError: false },
      eventsQueryData: [archivedEvent],
      eventsHasMore: false,
      eventsLoadingMore: false,
      onLoadMoreEvents: vi.fn(),
    });
    const { result } = renderHook(
      () => useEventsFiltering({ currentUserId: "member-1" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mocks.fetchEventDetailBatch).toHaveBeenCalledWith(["archived-event-2"]);
    });

    expect(result.current.eventStatus).toBe("active");
    expect(result.current.sortedEvents).toEqual([archivedEvent]);
    await waitFor(() => {
      expect(result.current.eventMembersMap.get("archived-event-2")?.[0]?.user.id).toBe("member-1");
    });
    expect(mocks.useMemberDirectory).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      selectedIds: ["member-1"],
    }));
  });

  it("requests the public member projection for an anonymous visitor", () => {
    renderHook(
      () => useEventsFiltering({ currentUserId: undefined }),
      { wrapper: createWrapper() },
    );

    expect(mocks.useMemberDirectory).toHaveBeenCalledWith(expect.objectContaining({
      publicMemberProjection: true,
    }));
    expect(mocks.useMemberAvailabilitySummary).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
