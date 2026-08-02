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

function eventRow(
  id: string,
  pinned: boolean,
  startAt = "2026-08-01T20:00:00.000Z",
): DashboardUpcomingEventRow {
  return {
    item: {
      id,
      title: `Event ${id}`,
      description: null,
      type: "social",
      start_at: startAt,
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

  it("orders featured and ordinary rows as one chronological list", () => {
    render(
      <MantineProvider>
        <UpcomingEventsCard
          upcomingEventsCount={4}
          featuredRows={[
            eventRow("featured-late", true, "2026-08-03T20:00:00.000Z"),
            eventRow("featured-latest", true, "2026-08-04T20:00:00.000Z"),
          ]}
          rows={[
            eventRow("regular-first", false, "2026-07-31T20:00:00.000Z"),
            eventRow("regular-second", false, "2026-08-01T20:00:00.000Z"),
          ]}
          onOpenEvent={vi.fn()}
          onViewAll={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText(/^Event /).map((node) => node.textContent)).toEqual([
      "Event regular-first",
      "Event regular-second",
      "Event featured-late",
      "Event featured-latest",
    ]);
  });
});
