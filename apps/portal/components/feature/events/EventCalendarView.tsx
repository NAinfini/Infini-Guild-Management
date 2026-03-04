import type { Event } from "@guild/shared";
import { EventMonthView } from "./EventMonthView";

type EventCalendarViewProps = {
  showAvailabilityOverlay: boolean;
  canManage: boolean;
  eventsByDay: Map<string, Event[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onEditEvent: (event: Event) => void;
};

export function EventCalendarView({
  showAvailabilityOverlay,
  canManage,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  onSelectDate,
  onCreateEvent,
  onEditEvent,
}: EventCalendarViewProps) {
  return (
    <EventMonthView
      showAvailabilityOverlay={showAvailabilityOverlay}
      onSelectDate={onSelectDate}
      canManage={canManage}
      eventsByDay={eventsByDay}
      availabilityDayPeakByDay={availabilityDayPeakByDay}
      availabilityMaxCount={availabilityMaxCount}
      onCreateEvent={onCreateEvent}
      onEditEvent={onEditEvent}
    />
  );
}
