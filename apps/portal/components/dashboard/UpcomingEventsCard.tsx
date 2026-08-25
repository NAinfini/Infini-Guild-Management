import type { Event } from "@guild/shared";
import { MemberAvatarStack } from "../shared/MemberAvatarStack";
import { ArrowRightIcon, ClockIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card } from "@portal/components/ui/card";
import { memo, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EventQuotaBar } from "../feature/events/EventQuotaBar";
import { EventTypeIcon } from "../shared/EventTypeIcon";
import { formatEventTime, formatLocaleParts } from "@portal/utils/datetime";
import { getEventTypeLabel } from "@portal/utils/game-rules";
import { EmptyState } from "../shared/EmptyState";
import {
  cardHeading,
  eventTypeTagColor,
  orderDashboardUpcomingRows,
  type DashboardUpcomingEventRow,
} from "./shared";

type UpcomingEventsCardProps = {
  upcomingEventsCount: number;
  featuredRows: DashboardUpcomingEventRow[];
  rows: DashboardUpcomingEventRow[];
  onOpenEvent: (event: Pick<Event, "id" | "title">) => void;
  onViewAll: () => void;
};

export const UpcomingEventsCard = memo(function UpcomingEventsCard({
  upcomingEventsCount,
  featuredRows,
  rows,
  onOpenEvent,
  onViewAll,
}: UpcomingEventsCardProps) {
  const { t, i18n } = useTranslation("dashboard");
  const safeUpcomingCount = Math.max(0, upcomingEventsCount);
  const hasAnyRows = featuredRows.length > 0 || rows.length > 0;
  const orderedRows = useMemo(
    () => orderDashboardUpcomingRows([...featuredRows, ...rows]),
    [featuredRows, rows],
  );

  return (
    <Card className="dashboard-card gap-0 py-0">
      <div>
      <div className="dashboard-card-heading-row">
        {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Button size="xs" variant="ghost" onClick={onViewAll}>
            {t("card.upcomingEvents.viewAll", { count: safeUpcomingCount })}
          </Button>
        ) : null}
      </div>
        {!hasAnyRows ? (
          <EmptyState title={t("card.upcomingEvents.empty")} />
        ) : (
          <div className="upcoming-event-list">
            {orderedRows.map((item) => {
              const signedUpCount = item.participantCount;
              const capacity = item.item.capacity ?? 0;
              const startDate = new Date(item.item.start_at);
              const month = formatLocaleParts(startDate, i18n.language, { month: "short" }).toUpperCase();
              const day = startDate.getDate();

              return (
                <div
                  key={item.item.id}
                  className="upcoming-event-row"
                  data-has-quota={item.quotaSummary ? "true" : undefined}
                >
                  <div className="upcoming-event-row__grid">
                    <div className="upcoming-event-row__date">
                      <span className="upcoming-event-row__month">{month}</span>
                      <span className="upcoming-event-row__day">{day}</span>
                    </div>
                    <div className="upcoming-event-row__main">
                      <strong className="upcoming-event-row__title">
                        {item.item.title}
                      </strong>
                      {item.item.description ? (
                        <p className="upcoming-event-row__description">
                          {item.item.description}
                        </p>
                      ) : null}
                      <div className="upcoming-event-row__meta">
                        <Badge
                          variant="outline"
                          className="upcoming-event-row__type dashboard-event-type-badge"
                          style={{ "--badge-color": eventTypeTagColor(item.item.type) } as CSSProperties}
                        >
                          <EventTypeIcon eventType={item.item.type} />
                          {getEventTypeLabel(item.item.type, i18n.language)}
                        </Badge>
                        <span className="upcoming-event-row__time">
                          <ClockIcon size={12} style={{ opacity: 0.6 }} />
                          <span>
                            {formatEventTime(startDate, i18n.language)}
                          </span>
                        </span>
                      </div>
                    </div>
                    {item.quotaSummary ? (
                      <div className="upcoming-event-row__quota">
                        <EventQuotaBar
                          summary={item.quotaSummary}
                          event={item.item}
                          participantCount={item.participantCount}
                        />
                      </div>
                    ) : null}
                    <div className="upcoming-event-row__people">
                      <div className="upcoming-event-row__avatars">
                        <MemberAvatarStack members={item.members} totalCount={item.participantCount} />
                      </div>
                      <span
                        className="upcoming-event-row__capacity"
                        aria-label={t("card.upcomingEvents.capacity", {
                          current: signedUpCount,
                          capacity: capacity > 0 ? capacity : "∞",
                        })}
                      >
                        {capacity > 0 ? `${signedUpCount}/${capacity}` : "∞"}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenEvent(item.item)}
                      className="upcoming-event-row__go"
                      aria-label={t("card.upcomingEvents.viewEvent")}
                    >
                      <ArrowRightIcon size={16} />
                    </Button>
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
