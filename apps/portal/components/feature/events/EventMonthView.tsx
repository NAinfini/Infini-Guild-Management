import type { Event as GuildEvent } from "@guild/shared";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@portal/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { eventTypeColor } from "@portal/utils/event-colors";
import { addDays, addMonths, getDate, getDay, getMonth, isSameDay, isValid, parseISO, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { formatEventTime, formatLocaleParts, localDateKey } from "@portal/utils/datetime";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getEventTypeLabel } from "@portal/utils/game-rules";
import { CalendarEventIcon, ChevronLeftIcon, ChevronRightIcon } from "@portal/components/icons";
import "./EventMonthView.css";

const WEEKDAY_KEYS = ["weekday.sun", "weekday.mon", "weekday.tue", "weekday.wed", "weekday.thu", "weekday.fri", "weekday.sat"] as const;

function startOfMonthGrid(base: Date): Date { return startOfWeek(startOfMonth(base)); }
function isMutedMonthEvent(event: GuildEvent): boolean { return Boolean(event.archived_at || (event.end_at && new Date(event.end_at) < new Date())); }

type MonthCalendarProps = {
  onSelect: (value: Date) => void;
  cellRender: (value: Date) => ReactNode;
  hasEvents: (value: Date) => boolean;
  value: Date;
  selectedDateKey?: string;
};

function MonthCalendar({ onSelect, cellRender, hasEvents, value, selectedDateKey }: MonthCalendarProps) {
  const { t, i18n } = useTranslation("events");
  const today = new Date();
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(startOfMonthGrid(value), index)), [value]);
  const scheduledDays = days.filter((day) => {
    if (getMonth(day) !== getMonth(value)) return false;
    return hasEvents(day) || localDateKey(day) === selectedDateKey;
  });
  return <>
    <div className="month-calendar month-calendar--grid">
      <div className="month-calendar__header" role="row">{WEEKDAY_KEYS.map((key) => <div key={key} className="month-calendar__weekday" role="columnheader">{t(key)}</div>)}</div>
      <div className="month-calendar__grid" role="grid" aria-label={t("month.gridAria", { month: formatLocaleParts(value, i18n.language, { month: "long", year: "numeric" }) })}>
        {days.map((day) => {
          const isAdjacentMonth = getMonth(day) !== getMonth(value);
          const isToday = isSameDay(day, today);
          const isWeekend = getDay(day) === 0 || getDay(day) === 6;
          const dateKey = localDateKey(day);
          const isSelected = dateKey === selectedDateKey;
          const className = `month-calendar__cell${isAdjacentMonth ? " month-calendar__cell--adjacent" : ""}${isToday ? " month-calendar__cell--today" : ""}${isWeekend ? " month-calendar__cell--weekend" : ""}${isSelected ? " month-calendar__cell--selected" : ""}`;
          return <div key={dateKey} className={className} role="gridcell"><button type="button" className="month-calendar__date-button" onClick={() => onSelect(day)} aria-label={t("month.selectAria", { date: dateKey })} aria-pressed={isSelected}><span className="month-calendar__date">{getDate(day)}</span></button><div className="month-calendar__cell-body">{cellRender(day)}</div></div>;
        })}
      </div>
    </div>
    <div className="month-calendar month-calendar--compact">
      {scheduledDays.length === 0 ? <p className="month-calendar__compact-empty">{t("month.empty")}</p> : <div className="month-calendar__compact-list">{scheduledDays.map((day) => { const dateKey = localDateKey(day); const isSelected = dateKey === selectedDateKey; return <article key={dateKey} className="month-calendar__compact-day"><button type="button" className="month-calendar__compact-date" onClick={() => onSelect(day)} aria-label={t("month.selectAria", { date: dateKey })} aria-pressed={isSelected}><span className="month-calendar__compact-weekday">{t(WEEKDAY_KEYS[getDay(day)] ?? "weekday.sun")}</span><span className="month-calendar__compact-date-number">{getDate(day)}</span><span className="month-calendar__compact-date-label">{formatLocaleParts(day, i18n.language, { month: "short" })}</span></button><div className="month-calendar__compact-events">{cellRender(day)}</div></article>; })}</div>}
    </div>
  </>;
}

type EventMonthViewProps = {
  canCreate: boolean;
  eventsByDay: Map<string, GuildEvent[]>;
  availabilityDayPeakByDay: Map<number, number>;
  availabilityMaxCount: number;
  selectedDateKey?: string;
  onSelectDate: (dateKey: string) => void;
  onCreateEvent: (dateKey: string) => void;
  onViewEvent: (event: GuildEvent) => void;
};

export function EventMonthView({ canCreate, eventsByDay, availabilityDayPeakByDay: _availabilityDayPeakByDay, availabilityMaxCount: _availabilityMaxCount, selectedDateKey, onSelectDate, onCreateEvent, onViewEvent }: EventMonthViewProps) {
  const { t, i18n } = useTranslation("events");
  const [activeMonth, setActiveMonth] = useState(() => {
    const selected = selectedDateKey ? parseISO(selectedDateKey) : null;
    return startOfMonth(selected && isValid(selected) ? selected : new Date());
  });
  useEffect(() => {
    const selected = selectedDateKey ? parseISO(selectedDateKey) : null;
    if (selected && isValid(selected)) {
      setActiveMonth(startOfMonth(selected));
    }
  }, [selectedDateKey]);
  const selectDate = (value: Date) => {
    setActiveMonth(startOfMonth(value));
    onSelectDate(localDateKey(value));
  };
  const monthLabel = formatLocaleParts(activeMonth, i18n.language, { month: "long", year: "numeric" });
  const renderDay = (value: Date) => {
    const key = localDateKey(value);
    const dayEvents = eventsByDay.get(key) ?? [];
    if (dayEvents.length === 0) return canCreate ? <button type="button" className="month-calendar__create-btn" onClick={() => onCreateEvent(key)} aria-label={t("month.createAria", { date: key })}><span aria-hidden="true">+</span>{t("month.create")}</button> : null;
    return <div className="month-calendar__event-stack">{dayEvents.slice(0, 3).map((event) => <MonthEvent key={event.id} event={event} onViewEvent={onViewEvent} />)}{dayEvents.length > 3 ? <MoreEvents events={dayEvents.slice(3)} onViewEvent={onViewEvent} /> : null}</div>;
  };
  return <Card className="event-month-view p-0">
    <header className="event-month-view__heading"><div><span className="event-month-view__eyebrow">{t("view.calendar")}</span><h2 className="event-month-view__title">{monthLabel}</h2></div><div className="event-month-view__controls"><Button type="button" variant="outline" size="icon-sm" onClick={() => setActiveMonth((month) => subMonths(month, 1))} aria-label={t("month.previous")}><ChevronLeftIcon size={16} /></Button><Button type="button" variant="ghost" size="sm" onClick={() => setActiveMonth(startOfMonth(new Date()))}>{t("month.today")}</Button><Button type="button" variant="outline" size="icon-sm" onClick={() => setActiveMonth((month) => addMonths(month, 1))} aria-label={t("month.next")}><ChevronRightIcon size={16} /></Button></div></header>
    <MonthCalendar value={activeMonth} selectedDateKey={selectedDateKey} hasEvents={(value) => (eventsByDay.get(localDateKey(value))?.length ?? 0) > 0} onSelect={selectDate} cellRender={renderDay} />
  </Card>;
}

function MonthEvent({ event, onViewEvent }: { event: GuildEvent; onViewEvent: (event: GuildEvent) => void }) {
  const { t, i18n } = useTranslation("events");
  const muted = isMutedMonthEvent(event);
  const eventColor = muted ? "var(--text-muted)" : eventTypeColor(event.type);
  return <Tooltip><TooltipTrigger render={<button type="button" className="month-calendar__event-button" aria-label={t("month.openEventAria", { title: event.title })} onClick={() => onViewEvent(event)} />}><Badge variant="outline" className={muted ? "month-calendar__event-badge--muted" : undefined} style={{ "--month-event-color": eventColor } as CSSProperties}>{event.title}</Badge><span className="month-calendar__event-time">{formatEventTime(event.start_at, i18n.language, { hour12: false })}</span></TooltipTrigger><TooltipContent className="month-calendar__event-tooltip" style={{ "--month-event-color": eventColor } as CSSProperties}><span className="month-calendar__event-tooltip-icon"><CalendarEventIcon size={18} /></span><span><strong>{event.title}</strong><span>{getEventTypeLabel(event.type)}</span><span>{formatEventTime(event.start_at, i18n.language, { hour12: false })}</span>{event.description ? <span>{event.description}</span> : null}</span></TooltipContent></Tooltip>;
}

function MoreEvents({ events, onViewEvent }: { events: GuildEvent[]; onViewEvent: (event: GuildEvent) => void }) {
  const { t } = useTranslation("events");
  return <Popover><PopoverTrigger render={<Button type="button" className="month-calendar__more-button" variant="ghost" size="xs" />}>+{events.length} {t("month.more")}</PopoverTrigger><PopoverContent className="month-calendar__more-popover" side="bottom" align="start">{events.map((event) => <Button key={event.id} size="sm" variant="ghost" className="month-calendar__more-event" onClick={() => onViewEvent(event)}>{event.title}</Button>)}</PopoverContent></Popover>;
}
