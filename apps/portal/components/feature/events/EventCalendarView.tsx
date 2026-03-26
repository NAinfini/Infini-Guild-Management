import type { Event } from "@guild/shared";
import { EventMonthView } from "./EventMonthView";

type EventCalendarViewProps = {
  canManage: boolean;
  eventsByDay: Map<string, Event[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onEditEvent: (event: Event) => void;
  onViewEvent?: (event: Event) => void;
};

export function EventCalendarView({
  canManage,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  onSelectDate,
  onCreateEvent,
  onEditEvent,
  onViewEvent,
}: EventCalendarViewProps) {
  return (
    <EventMonthView
      onSelectDate={onSelectDate}
      canManage={canManage}
      eventsByDay={eventsByDay}
      availabilityDayPeakByDay={availabilityDayPeakByDay}
      availabilityMaxCount={availabilityMaxCount}
      onCreateEvent={onCreateEvent}
      onEditEvent={onEditEvent}
      onViewEvent={onViewEvent}
    />
  );
}
