import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEventsFiltering } from "./useEventsFiltering";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchMemberAvailabilitySummary: vi.fn(),
  useEventsData: vi.fn(),
  useMemberDirectory: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./data/useEventsData", () => ({ useEventsData: mocks.useEventsData }));

vi.mock("./data/useMemberDirectory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data/useMemberDirectory")>();
  return { ...actual, useMemberDirectory: mocks.useMemberDirectory };
});

vi.mock("../services/UserService", () => ({
  fetchMemberAvailabilitySummary: mocks.fetchMemberAvailabilitySummary,
  fetchMemberDirectory: vi.fn(),
  fetchMemberIdentities: vi.fn(),
  fetchMemberPlanning: vi.fn(),
}));

vi.mock("../services/EventService", () => ({ fetchEventDetailBatch: vi.fn() }));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useEventsFiltering availability projection", () => {
  it("clears cached internal availability when switching to external view without another request", async () => {
    mocks.fetchMemberAvailabilitySummary.mockResolvedValue({
      hourly_counts: Array.from({ length: 7 }, (_, day) => (
        Array.from({ length: 24 }, (_, hour) => (day === 0 && hour === 20 ? 7 : 0))
      )),
      member_count: 7,
    });
    mocks.useEventsData.mockReturnValue({
      eventsQuery: { isError: false },
      eventsQueryData: [],
      eventsHasMore: false,
      eventsLoadingMore: false,
      onLoadMoreEvents: vi.fn(),
    });
    mocks.useMemberDirectory.mockReturnValue({ entries: [], isError: false });

    const { result, rerender } = renderHook(
      ({ externalView }) => useEventsFiltering({ currentUserId: "member-1", externalView }),
      { initialProps: { externalView: false }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.availabilityHeatData.memberCount).toBe(7));
    expect(mocks.fetchMemberAvailabilitySummary).toHaveBeenCalledTimes(1);

    rerender({ externalView: true });

    expect(result.current.availabilityHeatData.memberCount).toBe(0);
    expect(result.current.availabilityHeatData.maxCount).toBe(0);
    expect(result.current.availabilitySummaryError).toBe(false);
    expect(mocks.fetchMemberAvailabilitySummary).toHaveBeenCalledTimes(1);
  });
});
