import type { Event as GuildEvent } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { PortalCard } from "../../shared/PortalCard";
import { Badge, Button, Group, HoverCard, Popover, Stack, Text, ThemeIcon } from "@mantine/core";
import { addDays, format, getDate, getDay, getMonth, isSameDay, startOfMonth, startOfWeek } from "date-fns";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventIcon } from "@portal/components/icons";
import "./EventMonthView.css";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

// Derived from game config — single source of truth, includes all configured types
// (weekly_mission, guild_war, social, poll, raffle, other, and any future additions).
const EVENT_TYPE_COLORS: Record<string, string> = Object.fromEntries(
  activeGame.eventTypes.map((et) => [et.id, et.color]),
);

function buildAvailabilityOverlayStyle(intensity: number, maxCount: number): CSSProperties | undefined {
  if (!maxCount || intensity <= 0) {
    return undefined;
  }
  const ratio = Math.min(1, intensity / maxCount);
  const strength = Math.round(10 + ratio * 72);
  return {
    background: `color-mix(in srgb, var(--color-success, #22c55e) ${strength}%, transparent)`,
  };
}

function startOfMonthGrid(base: Date): Date {
  return startOfWeek(startOfMonth(base));
}

function isMutedMonthEvent(event: GuildEvent): boolean {
  return Boolean(event.archived_at || (event.end_at && new Date(event.end_at) < new Date()));
}

type MonthCalendarProps = {
  onSelect: (value: Date) => void;
  cellRender: (value: Date) => ReactNode;
  value?: Date;
};

function MonthCalendar({ onSelect, cellRender, value }: MonthCalendarProps) {
  const { t } = useTranslation("events");
  const active = value ?? new Date();
  const today = new Date();
  const start = startOfMonthGrid(active);
  const days = Array.from({ length: 42 }).map((_, index) => addDays(start, index));

  return (
    <div className="month-calendar">
      <div className="month-calendar__header">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="month-calendar__weekday">
            {t(key)}
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
  eventsByDay: Map<string, GuildEvent[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onEditEvent: (event: GuildEvent) => void;
  onViewEvent?: (event: GuildEvent) => void;
};

export function EventMonthView({
  canManage,
  eventsByDay,
  availabilityDayPeakByDay,
  availabilityMaxCount,
  onSelectDate,
  onCreateEvent,
  onEditEvent,
  onViewEvent,
}: EventMonthViewProps) {
  const { t } = useTranslation("events");

  return (
    <PortalCard interactive={false}>
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
                aria-label={t("month.createAria", { date: key })}
              >
                + {t("month.create")}
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
                {dayEvents.slice(0, 3).map((event) => {
                  const isMuted = isMutedMonthEvent(event);
                  const eventColor = isMuted ? "gray" : EVENT_TYPE_COLORS[event.type] ?? "gray";
                  return (
                    <HoverCard key={event.id} width={260} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                      <HoverCard.Target>
                        <Badge
                          variant="light"
                          color={eventColor}
                          size="xs"
                          className={isMuted ? "month-calendar__event-badge--muted" : undefined}
                          style={{ cursor: "pointer" }}
                          data-animate-icon-trigger
                          onClick={(e) => {
                            e.stopPropagation();
                            (onViewEvent ?? onEditEvent)(event);
                          }}
                        >
                          {event.title}
                        </Badge>
                      </HoverCard.Target>
                      <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                        <Group gap={10} wrap="nowrap" align="flex-start">
                          <ThemeIcon variant="light" color={eventColor} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                            <CalendarEventIcon size={18} />
                          </ThemeIcon>
                          <div style={{ minWidth: 0 }}>
                            <Text size="sm" fw={700} lh={1.3}>{event.title}</Text>
                            <Group gap={4} mt={4}>
                              <Text size="xs">{t(`common:eventType.${event.type}`)}</Text>
                              <Text size="xs" c="dimmed">{format(new Date(event.start_at), "HH:mm")}</Text>
                            </Group>
                            {event.description ? (
                              <Text size="xs" c="dimmed" lh={1.5} mt={4} lineClamp={2}>{event.description}</Text>
                            ) : null}
                          </div>
                        </Group>
                      </HoverCard.Dropdown>
                    </HoverCard>
                  );
                })}
                {dayEvents.length > 3 ? (
                  <Popover withinPortal>
                    <Popover.Target>
                      <Badge color="gray" variant="light" size="xs" style={{ cursor: "pointer" }}>
                        +{dayEvents.length - 3} {t("month.more")}
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
                            onClick={() => (onViewEvent ?? onEditEvent)(event)}
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
    </PortalCard>
  );
}
