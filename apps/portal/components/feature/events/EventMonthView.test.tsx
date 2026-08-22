import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Event } from "@guild/shared";
import { addDays, format } from "date-fns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventMonthView } from "./EventMonthView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "month.selectAria") return `Select ${options?.date}`;
      if (key === "month.createAria") return `Create ${options?.date}`;
      if (key === "month.openEventAria") return `Open ${options?.title}`;
      return key;
    },
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

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

function renderMonthView(
  events: Event[],
  options: {
    canManage?: boolean;
    onSelectDate?: (dateKey: string) => void;
    onCreateEvent?: (dateKey: string) => void;
    onEditEvent?: (event: Event) => void;
    onViewEvent?: (event: Event) => void;
  } = {},
) {
  const eventsByDay = new Map<string, Event[]>();
  for (const event of events) {
    const key = event.start_at.slice(0, 10);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }

  render(
    <MantineProvider>
      <EventMonthView
        canManage={options.canManage ?? false}
        eventsByDay={eventsByDay}
        availabilityDayPeakByDay={new Map()}
        availabilityMaxCount={0}
        onSelectDate={options.onSelectDate ?? (() => {})}
        onCreateEvent={options.onCreateEvent ?? (() => {})}
        onEditEvent={options.onEditEvent ?? (() => {})}
        onViewEvent={options.onViewEvent}
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

  it("keeps date selection, creation, and event opening as separate keyboard controls", async () => {
    const user = userEvent.setup();
    const onSelectDate = vi.fn();
    const onCreateEvent = vi.fn();
    const onViewEvent = vi.fn();
    const today = new Date();
    const todayKey = format(today, "yyyy-MM-dd");
    const tomorrowKey = format(addDays(today, 1), "yyyy-MM-dd");
    const event = createEvent({
      title: "Keyboard Run",
      start_at: `${todayKey}T16:00:00.000Z`,
      end_at: `${todayKey}T18:00:00.000Z`,
    });

    renderMonthView([event], {
      canManage: true,
      onSelectDate,
      onCreateEvent,
      onViewEvent,
    });

    expect(document.querySelector(".month-calendar__cell[role='button']")).not.toBeInTheDocument();
    expect(document.querySelector("button button")).not.toBeInTheDocument();

    const dateButton = screen.getByRole("button", { name: `Select ${todayKey}` });
    dateButton.focus();
    await user.keyboard("{Enter}");
    expect(onSelectDate).toHaveBeenCalledWith(todayKey);

    const createButton = screen.getByRole("button", { name: `Create ${tomorrowKey}` });
    createButton.focus();
    await user.keyboard(" ");
    expect(onCreateEvent).toHaveBeenCalledWith(tomorrowKey);

    const eventButton = screen.getByRole("button", { name: "Open Keyboard Run" });
    eventButton.focus();
    await user.keyboard("{Enter}");
    expect(onViewEvent).toHaveBeenCalledWith(event);
  });
});
