import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  navigate: vi.fn(),
  warningToast: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
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
    selector: (state: { features: { events: boolean; guildWar: boolean } }) => unknown,
  ) => selector({ features: { events: true, guildWar: true } }),
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

vi.mock("../dashboard/ActiveMembersCard", () => ({
  ActiveMembersCard: () => <div>active-members-card</div>,
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
    mocks.warningToast.mockReset();
  });

  it("shows a retryable error instead of zero-valued cards when an initial query fails", () => {
    const retryMembers = vi.fn();
    const memberQuery = {
        data: undefined,
        dataUpdatedAt: 0,
        isError: true,
        isFetching: false,
        isLoading: false,
        refetch: retryMembers,
    };
    const eventsQuery = successfulQuery({
      active_events_count: 0,
      featured_events: [],
      my_signup_event_ids: [],
      upcoming_events: [],
    });
    const warsQuery = successfulQuery({
      all_war_win_rate: 0,
      recent_war_mvps: [],
      recent_wars: [],
    });
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[1] === "members") return memberQuery;
      if (queryKey[1] === "events") return eventsQuery;
      if (queryKey[1] === "wars") return warsQuery;
      throw new Error(`Unexpected dashboard query: ${String(queryKey[1])}`);
    });

    render(
      <MantineProvider>
        <DashboardPage />
      </MantineProvider>,
    );

    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    expect(screen.queryByText("active-members-card")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(retryMembers).toHaveBeenCalledOnce();
  });
});
