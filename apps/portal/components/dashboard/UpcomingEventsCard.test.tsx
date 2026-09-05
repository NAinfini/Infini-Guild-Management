import { fireEvent, render, screen } from "@testing-library/react";
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
      class_quotas: [] as DashboardUpcomingEventRow["item"]["class_quotas"],
    } as DashboardUpcomingEventRow["item"],
    startsSoon: false,
    hasConflict: false,
    members: [],
    participantCount: 0,
    joined: false,
    capacityLabel: "0/∞",
    isFull: false,
    quotaSummary: null,
  };
}

describe("UpcomingEventsCard", () => {
  it("shows all supplied event rows and handles view-all", () => {
    const onViewAll = vi.fn();
    render(
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
      />,
    );

    expect(screen.getAllByText(/^Event /)).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "View all 8" }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("orders featured and ordinary rows as one chronological list", () => {
    render(
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
      />,
    );

    expect(screen.getAllByText(/^Event /).map((node) => node.textContent)).toEqual([
      "Event regular-first",
      "Event regular-second",
      "Event featured-late",
      "Event featured-latest",
    ]);
  });

  it("groups quota and people as secondary details below the primary row when space is tight", () => {
    const row = eventRow("with-quota", false);
    row.quotaSummary = {
      slots: [],
      matchedTotal: 0,
      requiredTotal: 1,
    };

    const { container } = render(
      <UpcomingEventsCard
        upcomingEventsCount={1}
        featuredRows={[]}
        rows={[row]}
        onOpenEvent={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    const details = container.querySelector(".upcoming-event-row__details");
    expect(details).toHaveAttribute("data-has-quota", "true");
    expect(details?.querySelector(".upcoming-event-row__quota")).not.toBeNull();
    expect(details?.querySelector(".upcoming-event-row__people")).not.toBeNull();
  });
});
