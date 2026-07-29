import type { Event } from "@guild/shared";
import { HoverCard, ThemeIcon, Text, Badge, Group, Paper } from "@mantine/core";
import { CalendarEventIcon } from "@portal/components/icons";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserCheckOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading, eventTypeTagColor, formatDateTime, type DashboardMySignupEvent } from "./shared";

type MySignupsCardProps = {
  mySignupEvents: DashboardMySignupEvent[];
  now: Date;
  onOpenEvent: (event: Pick<Event, "id" | "title">) => void;
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const MySignupsCard = memo(function MySignupsCard({ mySignupEvents, now, onOpenEvent }: MySignupsCardProps) {
  const { t, i18n } = useTranslation("dashboard");

  const days = useMemo(() => {
    const result: { date: Date; label: string; dayLabel: string; isYesterday: boolean; events: DashboardMySignupEvent[] }[] = [];
    for (let offset = -1; offset <= 6; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const dayLabel = date.toLocaleString(i18n.language, { weekday: "short" });
      const label = `${date.getDate()}`;

      const dayEvents = mySignupEvents.filter((item) => {
        const startAt = new Date(item.event.start_at);
        return isSameDay(startAt, date);
      });

      result.push({ date, label, dayLabel, isYesterday: offset === -1, events: dayEvents });
    }
    return result;
  }, [mySignupEvents, now, i18n.language]);

  const isToday = (date: Date) => isSameDay(date, now);

  return (
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
        {cardHeading(t("card.mySignups.title"), <UserCheckOutlined size={18} />)}
      {/* With no signups the strip was eight identical boxes of "—" taking a full
          card of vertical space and saying nothing. */}
      {mySignupEvents.length === 0 ? (
        <EmptyState title={t("card.mySignups.empty")} />
      ) : (
      <div className="signup-boxes">
        {days.map((day) => {
          const today = isToday(day.date);
          const boxClass = `signup-box${today ? " signup-box--today" : ""}${day.isYesterday ? " signup-box--yesterday" : ""}`;

          return (
            <div key={day.date.toISOString()} className={boxClass}>
              <div className="signup-box-header">
                <span className="signup-box-label">{day.dayLabel}</span>
                <span className="signup-box-date">{day.label}</span>
              </div>
              <div className="signup-box-events">
                {day.events.length === 0 ? (
                  <span className="signup-box-empty">—</span>
                ) : (
                  day.events.map((item) => {
                    const color = `var(--mantine-color-${eventTypeTagColor(item.event.type)}-5, var(--brand-fill))`;

                    return (
                      <HoverCard key={item.event.id} width={280} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="top">
                        <HoverCard.Target>
                          <button
                            type="button"
                            className="signup-box-event"
                            onClick={() => onOpenEvent(item.event)}
                          >
                            <span
                              className="signup-box-event-dot"
                              style={{ "--signup-dot-color": color } as React.CSSProperties}
                            />
                            <span className="signup-box-event-title">{item.event.title}</span>
                            <span className="signup-box-event-time">{formatTime(item.event.start_at)}</span>
                          </button>
                        </HoverCard.Target>
                        <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                          <Group gap={10} wrap="nowrap" align="flex-start">
                            <ThemeIcon variant="light" color={eventTypeTagColor(item.event.type)} size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                              <CalendarEventIcon size={18} />
                            </ThemeIcon>
                            <div style={{ minWidth: 0 }}>
                              <Text size="sm" fw={700} lh={1.3}>{item.event.title}</Text>
                              <Group gap={4} mt={4}>
                                <Badge size="xs" color={eventTypeTagColor(item.event.type)} variant="light">
                                  {t(`common:eventType.${item.event.type}`)}
                                </Badge>
                                <Text size="xs" c="dimmed">{formatDateTime(item.event.start_at)}</Text>
                              </Group>
                              {item.event.description ? (
                                <Text size="xs" c="dimmed" lh={1.5} mt={4} lineClamp={2}>{item.event.description}</Text>
                              ) : null}
                            </div>
                          </Group>
                        </HoverCard.Dropdown>
                      </HoverCard>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
        )}
      </div>
    </Paper>
  );
});
