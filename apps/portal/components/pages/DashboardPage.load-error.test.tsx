import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
  navigate: vi.fn(),
  warningToast: vi.fn(),
  siteConfig: {
    siteName: "Test Guild",
    features: { announcements: true, events: true, guildWar: true },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useInfiniteQuery: mocks.useInfiniteQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("../../hooks/useLoadWarningToast", () => ({
  useLoadWarningToast: mocks.warningToast,
}));

vi.mock("../../stores/auth", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));

vi.mock("../../stores/site-config", () => ({
  useSiteConfigStore: (
    selector: (state: typeof mocks.siteConfig) => unknown,
  ) => selector(mocks.siteConfig),
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("../shared/EmptyState", () => ({
  EmptyState: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => (
    <section>
      <span>{title}</span>
      {actions}
    </section>
  ),
}));

vi.mock("../dashboard/LastWarCard", () => ({
  LastWarCard: () => <div>last-war-card</div>,
}));
vi.mock("../dashboard/MySignupsCard", () => ({
  MySignupsCard: () => <div>my-signups-card</div>,
}));
vi.mock("../dashboard/UpcomingEventsCard", () => ({
  UpcomingEventsCard: () => <div>upcoming-events-card</div>,
}));

import { DashboardPage } from "./DashboardPage";

function successfulQuery(data: unknown) {
  return {
    data,
    dataUpdatedAt: 1,
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  };
}

describe("DashboardPage initial load errors", () => {
  beforeEach(() => {
    mocks.useQuery.mockReset();
    mocks.useInfiniteQuery.mockReset();
    mocks.useInfiniteQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });
    mocks.warningToast.mockReset();
    mocks.siteConfig.features = { announcements: true, events: true, guildWar: true };
  });

  it("shows a retryable error instead of zero-valued cards when an initial query fails", () => {
    const retryEvents = vi.fn();
    const eventsQuery = {
        data: undefined,
        dataUpdatedAt: 0,
        isError: true,
        isFetching: false,
        isLoading: false,
        refetch: retryEvents,
    };
    const warsQuery = successfulQuery({
      all_war_win_rate: 0,
      recent_war_mvps: [],
      recent_wars: [],
    });
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[1] === "events") return eventsQuery;
      if (queryKey[1] === "wars") return warsQuery;
      if (queryKey[1] === "latest-announcement") return successfulQuery({ data: [] });
      throw new Error(`Unexpected dashboard query: ${String(queryKey[1])}`);
    });

    render(
      <DashboardPage />,
    );

    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    expect(screen.queryByText("my-signups-card")).not.toBeInTheDocument();
    expect(screen.queryByText("upcoming-events-card")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(retryEvents).toHaveBeenCalledOnce();
  });

  it("does not advertise disabled event, guild-war, or announcement features", () => {
    mocks.siteConfig.features = { announcements: false, events: false, guildWar: false };
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[1] === "events") {
        return successfulQuery({ active_events_count: 0, featured_events: [], my_signup_event_ids: [], upcoming_events: [] });
      }
      if (queryKey[1] === "wars") {
        return successfulQuery({ all_war_win_rate: 0, recent_war_mvps: [], recent_wars: [] });
      }
      if (queryKey[1] === "latest-announcement") return successfulQuery({ data: [] });
      throw new Error(`Unexpected dashboard query: ${String(queryKey[1])}`);
    });

    render(
      <DashboardPage />,
    );

    expect(screen.queryByText("my-signups-card")).not.toBeInTheDocument();
    expect(screen.queryByText("upcoming-events-card")).not.toBeInTheDocument();
    expect(screen.queryByText("last-war-card")).not.toBeInTheDocument();
    expect(screen.queryByText("command.bulletin.label")).not.toBeInTheDocument();
  });

  it("does not announce an all-clear attention state while events are loading", () => {
    mocks.siteConfig.features = { announcements: false, events: true, guildWar: false };
    const loadingEventsQuery = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isFetching: true,
      isLoading: true,
      refetch: vi.fn(),
    };
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[1] === "events") return loadingEventsQuery;
      if (queryKey[1] === "wars") {
        return successfulQuery({ all_war_win_rate: 0, recent_war_mvps: [], recent_wars: [] });
      }
      if (queryKey[1] === "latest-announcement") return successfulQuery({ data: [] });
      throw new Error(`Unexpected dashboard query: ${String(queryKey[1])}`);
    });

    render(
      <DashboardPage />,
    );

    expect(screen.queryByText("attention.ready.title")).not.toBeInTheDocument();
  });
});
