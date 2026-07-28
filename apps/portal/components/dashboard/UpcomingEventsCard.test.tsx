// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import type { DashboardUpcomingEventRow } from "./shared";
import { UpcomingEventsCard } from "./UpcomingEventsCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: { count?: number }) =>
      key === "card.upcomingEvents.viewAll"
        ? `View all ${options?.count ?? 0}`
        : key,
  }),
}));

vi.mock("../shared/MemberRoleAvatar", () => ({
  MemberRoleAvatar: () => null,
}));

vi.mock("@portal/components/effects", () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));

function eventRow(id: string, pinned: boolean): DashboardUpcomingEventRow {
  return {
    item: {
      id,
      title: `Event ${id}`,
      description: null,
      type: "social",
      start_at: "2026-08-01T20:00:00.000Z",
      end_at: null,
      capacity: null,
      pinned,
    } as DashboardUpcomingEventRow["item"],
    startsSoon: false,
    hasConflict: false,
    members: [],
    joined: false,
    capacityLabel: "0/∞",
    isFull: false,
  };
}

describe("UpcomingEventsCard", () => {
  it("shows both server groups without a second truncation and links to all results", () => {
    const onViewAll = vi.fn();
    render(
      <MantineProvider>
        <UpcomingEventsCard
          upcomingEventsCount={8}
          featuredRows={[
            eventRow("featured-1", true),
            eventRow("featured-2", true),
            eventRow("featured-3", true),
          ]}
          rows={[
            eventRow("regular-1", false),
            eventRow("regular-2", false),
            eventRow("regular-3", false),
          ]}
          onOpenEvent={vi.fn()}
          onViewAll={onViewAll}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText(/^Event /)).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "View all 8" }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });
});
