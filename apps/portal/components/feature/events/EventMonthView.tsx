import type { Event } from "@guild/shared";
import { Badge, Button, Popover, Stack } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import dayjs, { type Dayjs } from "dayjs";
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

function startOfMonthGrid(base: Dayjs): Dayjs {
  return base.startOf("month").startOf("week");
}

type MonthCalendarProps = {
  onSelect: (value: Dayjs) => void;
  cellRender: (value: Dayjs) => ReactNode;
  value?: Dayjs;
};

function MonthCalendar({ onSelect, cellRender, value }: MonthCalendarProps) {
  const active = value ?? dayjs();
  const today = dayjs();
  const start = startOfMonthGrid(active);
  const days = Array.from({ length: 42 }).map((_, index) => start.add(index, "day"));

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
          const isAdjacentMonth = day.month() !== active.month();
          const isToday = day.isSame(today, "day");

          let cellClass = "month-calendar__cell";
          if (isAdjacentMonth) cellClass += " month-calendar__cell--adjacent";
          if (isToday) cellClass += " month-calendar__cell--today";

          return (
            <div
              key={day.format("YYYY-MM-DD")}
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
              <div className="month-calendar__date">{day.date()}</div>
              <div className="month-calendar__cell-body">{cellRender(day)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type EventMonthViewProps = {
  showAvailabilityOverlay: boolean;
  canManage: boolean;
  eventsByDay: Map<string, Event[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onEditEvent: (event: Event) => void;
};

export function EventMonthView({
  showAvailabilityOverlay,
  canManage,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  onSelectDate,
  onCreateEvent,
  onEditEvent,
}: EventMonthViewProps) {
  return (
    <InfiniCard>
      <MonthCalendar
        onSelect={(value) => onSelectDate(value.format("YYYY-MM-DD"))}
        cellRender={(value: Dayjs) => {
          const key = value.format("YYYY-MM-DD");
          const dayEvents = eventsByDay.get(key) ?? [];
          const dayIndex = value.day();
          const overlayIntensity =
            showAvailabilityOverlay && dayIndex !== null ? (availabilityDayPeakByDay.get(dayIndex) ?? 0) : 0;
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
                      <Badge color="blue" variant="light" size="xs" style={{ cursor: "pointer" }}>
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
