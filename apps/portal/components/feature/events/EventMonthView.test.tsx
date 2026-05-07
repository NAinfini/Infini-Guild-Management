// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { Event } from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import { EventMonthView } from "./EventMonthView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createEvent(overrides: Partial<Event>): Event {
  return {
    id: "event-1",
    type: "weekly_mission",
    title: "Event",
    description: null,
    start_at: "2026-05-07T16:00:00.000Z",
    end_at: "2026-05-07T18:00:00.000Z",
    capacity: null,
    pinned: false,
    signup_locked: false,
    auto_archive: false,
    auto_archived: false,
    visible_at: null,
    archived_at: null,
    created_by: "user-1",
    recurrence_rule: null,
    attachments: [],
    series_id: null,
    is_series_parent: false,
    instance_date: null,
    created_at: "2026-05-07T16:00:00.000Z",
    updated_at: "2026-05-07T16:00:00.000Z",
    ...overrides,
  } as Event;
}

function renderMonthView(events: Event[]) {
  const eventsByDay = new Map<string, Event[]>();
  for (const event of events) {
    const key = event.start_at.slice(0, 10);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }

  render(
    <MantineProvider>
      <EventMonthView
        canManage={false}
        eventsByDay={eventsByDay}
        availabilityDayPeakByDay={new Map()}
        availabilityMaxCount={0}
        onSelectDate={() => {}}
        onCreateEvent={() => {}}
        onEditEvent={() => {}}
      />
    </MantineProvider>,
  );
}

describe("EventMonthView", () => {
  it("dims closed polls in the active month like past events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T16:11:00.000Z"));

    renderMonthView([
      createEvent({
        id: "poll-closed",
        type: "poll",
        title: "Poll: Closed Example",
        start_at: "2026-05-01T16:00:00.000Z",
        end_at: "2026-05-01T18:00:00.000Z",
      }),
    ]);

    expect(screen.getByText("Poll: Closed Example").closest(".mantine-Badge-root")).toHaveClass(
      "month-calendar__event-badge--muted",
    );

    vi.useRealTimers();
  });
});
