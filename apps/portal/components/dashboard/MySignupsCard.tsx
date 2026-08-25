import type { Event } from "@guild/shared";
import { CalendarEventIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@portal/components/ui/preview-card";
import { memo, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { UserCheckOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading, eventTypeTagColor, type DashboardMySignupEvent } from "./shared";
import { formatEventTime, formatLocaleDate, formatLocaleParts } from "@portal/utils/datetime";
import { getEventTypeLabel } from "@portal/utils/game-rules";

type MySignupsCardProps = {
  mySignupEvents: DashboardMySignupEvent[];
  now: Date;
  onOpenEvent: (event: Pick<Event, "id" | "title">) => void;
  onBrowseEvents: () => void;
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const MySignupsCard = memo(function MySignupsCard({
  mySignupEvents,
  now,
  onOpenEvent,
  onBrowseEvents,
}: MySignupsCardProps) {
  const { t, i18n } = useTranslation("dashboard");

  const days = useMemo(() => {
    const result: { date: Date; label: string; dayLabel: string; isYesterday: boolean; events: DashboardMySignupEvent[] }[] = [];
    for (let offset = -1; offset <= 6; offset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);

      const dayLabel = formatLocaleParts(date, i18n.language, { weekday: "short" });
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
    <Card className="dashboard-card gap-0 py-0">
      <div>
        {cardHeading(t("card.mySignups.title"), <UserCheckOutlined size={18} />)}
      {/* With no signups the strip was eight identical boxes of "—" taking a full
          card of vertical space and saying nothing. */}
      {mySignupEvents.length === 0 ? (
        <EmptyState
          className="dashboard-signups-empty"
          icon={(
            <CalendarEventIcon
              aria-hidden="true"
              className="dashboard-signups-empty__icon"
              size={28}
            />
          )}
          title={t("card.mySignups.empty")}
          actions={(
            <Button onClick={onBrowseEvents}>
              {t("card.mySignups.browseEvents")}
            </Button>
          )}
        />
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
                    const color = eventTypeTagColor(item.event.type);

                    return (
                      <PreviewCard key={item.event.id}>
                        <PreviewCardTrigger
                          delay={350}
                          closeDelay={80}
                          render={(
                            <button
                              type="button"
                              className="signup-box-event"
                              onClick={() => onOpenEvent(item.event)}
                            />
                          )}
                        >
                            <span
                              className="signup-box-event-dot"
                              style={{ "--signup-dot-color": color } as CSSProperties}
                            />
                            <span className="signup-box-event-title">{item.event.title}</span>
                            <span className="signup-box-event-time">{formatEventTime(item.event.start_at, i18n.language)}</span>
                        </PreviewCardTrigger>
                        <PreviewCardContent side="top" className="signup-event-preview">
                          <div className="signup-event-preview__layout">
                            <span
                              className="signup-event-preview__icon"
                              style={{ "--badge-color": color } as CSSProperties}
                            >
                              <CalendarEventIcon size={18} />
                            </span>
                            <div className="signup-event-preview__body">
                              <strong className="signup-event-preview__title">{item.event.title}</strong>
                              <div className="signup-event-preview__meta">
                                <Badge
                                  variant="outline"
                                  className="dashboard-event-type-badge"
                                  style={{ "--badge-color": color } as CSSProperties}
                                >
                                  {getEventTypeLabel(item.event.type, i18n.language)}
                                </Badge>
                                <span>
                                  {formatLocaleDate(item.event.start_at, i18n.language)}{" "}
                                  {formatEventTime(item.event.start_at, i18n.language)}
                                </span>
                              </div>
                              {item.event.description ? (
                                <p className="signup-event-preview__description">{item.event.description}</p>
                              ) : null}
                            </div>
                          </div>
                        </PreviewCardContent>
                      </PreviewCard>
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
    </Card>
  );
});
