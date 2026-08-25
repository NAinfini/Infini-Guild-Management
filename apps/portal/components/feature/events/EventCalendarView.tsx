import type { Event } from "@guild/shared";
import { EventMonthView } from "./EventMonthView";

type EventCalendarViewProps = {
  canCreate: boolean;
  eventsByDay: Map<string, Event[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  selectedDateKey?: string;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onViewEvent: (event: Event) => void;
};

export function EventCalendarView({
  canCreate,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  selectedDateKey,
  onSelectDate,
  onCreateEvent,
  onViewEvent,
}: EventCalendarViewProps) {
  return (
    <EventMonthView
      onSelectDate={onSelectDate}
      selectedDateKey={selectedDateKey}
      canCreate={canCreate}
      eventsByDay={eventsByDay}
      availabilityDayPeakByDay={availabilityDayPeakByDay}
      availabilityMaxCount={availabilityMaxCount}
      onCreateEvent={onCreateEvent}
      onViewEvent={onViewEvent}
    />
  );
}
