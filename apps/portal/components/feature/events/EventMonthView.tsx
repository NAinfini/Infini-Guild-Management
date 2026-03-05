import { addDays, format, getDate, getDay, getMonth, isSameDay, startOfMonth, startOfWeek } from "date-fns";
import type { CSSProperties, ReactNode } from "react";
import "./EventMonthView.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildAvailabilityOverlayStyle(intensity: number, maxCount: number): CSSProperties | undefined {
  if (!maxCount || intensity <= 0) {
    return undefined;
  }
  const ratio = Math.min(1, intensity / maxCount);
  const strength = Math.round(10 + ratio * 72);
  return {
    background: `color-mix(in srgb, var(--infini-color-success, #22c55e) ${strength}%, transparent)`,
  };
}

function startOfMonthGrid(base: Date): Date {
  return startOfWeek(startOfMonth(base));
}

type MonthCalendarProps = {
  onSelect: (value: Date) => void;
  cellRender: (value: Date) => ReactNode;
  value?: Date;
};

function MonthCalendar({ onSelect, cellRender, value }: MonthCalendarProps) {
  const active = value ?? new Date();
  const today = new Date();
  const start = startOfMonthGrid(active);
  const days = Array.from({ length: 42 }).map((_, index) => addDays(start, index));

  return (
    <div className="month-calendar">
      <div className="month-calendar__header">
        {WEEKDAYS.map((day) => (
          <div key={day} className="month-calendar__weekday">
            {day}
          </div>
        ))}
      </div>
      <div className="month-calendar__grid">
        {days.map((day) => {
          const isAdjacentMonth = getMonth(day) !== getMonth(active);
          const isToday = isSameDay(day, today);

          let cellClass = "month-calendar__cell";
          if (isAdjacentMonth) cellClass += " month-calendar__cell--adjacent";
          if (isToday) cellClass += " month-calendar__cell--today";

          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              className={cellClass}
              onClick={() => onSelect(day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(day);
                }
              }}
            >
              <div className="month-calendar__date">{getDate(day)}</div>
              <div className="month-calendar__cell-body">{cellRender(day)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type EventMonthViewProps = {
  canManage: boolean;
  eventsByDay: Map<string, Event[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onEditEvent: (event: Event) => void;
};

export function EventMonthView({
  canManage,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  onSelectDate,
  onCreateEvent,
  onEditEvent,
}: EventMonthViewProps) {
  return (
    <InfiniCard interactive={false}>
      <MonthCalendar
        onSelect={(value) => onSelectDate(format(value, "yyyy-MM-dd"))}
        cellRender={(value: Date) => {
          const key = format(value, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const dayIndex = getDay(value);
          const overlayIntensity = availabilityDayPeakByDay.get(dayIndex) ?? 0;
          const overlayStyle = buildAvailabilityOverlayStyle(overlayIntensity, availabilityMaxCount);

          if (dayEvents.length === 0) {
            const emptyCell = (
              <div
                className="month-calendar__overlay"
                style={{
                  minHeight: 24,
                  ...overlayStyle,
                }}
              />
            );
            if (!canManage) {
              return emptyCell;
            }
            return (
              <button
                type="button"
                className="month-calendar__create-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateEvent(key);
                }}
                aria-label={`Create event on ${key}`}
              >
                + Create
                {emptyCell}
              </button>
            );
          }
          return (
            <div
              className="month-calendar__overlay"
              style={overlayStyle}
            >
              <Stack gap={2} style={{ width: "100%" }}>
                {dayEvents.slice(0, 3).map((event) => (
                  <Badge key={event.id} variant="light" size="xs">
                    {event.title}
                  </Badge>
                ))}
                {dayEvents.length > 3 ? (
                  <Popover withinPortal>
                    <Popover.Target>
                      <Badge color="infini-primary" variant="light" size="xs" style={{ cursor: "pointer" }}>
                        +{dayEvents.length - 3} more
                      </Badge>
                    </Popover.Target>
                    <Popover.Dropdown>
                      <Stack gap={4}>
                        {dayEvents.slice(3).map((event) => (
                          <Button
                            key={event.id}
                            size="xs"
                            variant="subtle"
                            style={{ justifyContent: "flex-start" }}
                            onClick={() => onEditEvent(event)}
                            disabled={!canManage}
                          >
                            {event.title}
                          </Button>
                        ))}
                      </Stack>
                    </Popover.Dropdown>
                  </Popover>
                ) : null}
              </Stack>
            </div>
          );
        }}
      />
    </InfiniCard>
  );
}

