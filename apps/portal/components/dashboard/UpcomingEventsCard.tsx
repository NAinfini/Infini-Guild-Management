import type { Event } from "@guild/shared";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { MemberAvatarStack } from "../shared/MemberAvatarStack";
import { ArrowRightIcon, ClockIcon } from "@portal/components/icons";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EventQuotaBar } from "../feature/events/EventQuotaBar";
import { EventTypeIcon } from "../shared/EventTypeIcon";
import { getEventTypeLabel } from "@portal/utils/game-rules";
import { useSiteConfigStore } from "@portal/stores/site-config";
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
  const gameRules = useSiteConfigStore((state) => state.gameRules);
  const safeUpcomingCount = Math.max(0, upcomingEventsCount);
  const hasAnyRows = featuredRows.length > 0 || rows.length > 0;
  const orderedRows = useMemo(
    () => orderDashboardUpcomingRows([...featuredRows, ...rows]),
    [featuredRows, rows],
  );

  return (
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
      <Group gap={8} align="center" wrap="nowrap" justify="space-between">
        {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Button size="xs" variant="subtle" onClick={onViewAll}>
            {t("card.upcomingEvents.viewAll", { count: safeUpcomingCount })}
          </Button>
        ) : null}
      </Group>
        {!hasAnyRows ? (
          <EmptyState title={t("card.upcomingEvents.empty")} />
        ) : (
          <Stack gap={8} mt={12}>
            {orderedRows.map((item) => {
              const signedUpCount = item.members.length;
              const capacity = item.item.capacity ?? 0;
              const startDate = new Date(item.item.start_at);
              const month = startDate.toLocaleString(i18n.language, { month: "short" }).toUpperCase();
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
                      <Text
                        fw={600}
                        size="sm"
                        lineClamp={2}
                        className="upcoming-event-row__title"
                      >
                        {item.item.title}
                      </Text>
                      {item.item.description ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {item.item.description}
                        </Text>
                      ) : null}
                      <Group gap={6}>
                        <Badge size="xs" color={eventTypeTagColor(item.item.type)} variant="light" leftSection={<EventTypeIcon eventType={item.item.type} />}>
                          {getEventTypeLabel(item.item.type, i18n.language, gameRules)}
                        </Badge>
                        <Group gap={4}>
                          <ClockIcon size={12} style={{ opacity: 0.6 }} />
                          <Text size="xs" c="dimmed">
                            {startDate.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </Text>
                        </Group>
                      </Group>
                    </div>
                    {item.quotaSummary ? (
                      <div className="upcoming-event-row__quota">
                        <EventQuotaBar
                          summary={item.quotaSummary}
                          event={item.item}
                          participantCount={item.members.length}
                        />
                      </div>
                    ) : null}
                    <div className="upcoming-event-row__people">
                      <div className="upcoming-event-row__avatars">
                        <MemberAvatarStack members={item.members} />
                      </div>
                      <Text
                        className="upcoming-event-row__capacity"
                        aria-label={t("card.upcomingEvents.capacity", {
                          current: signedUpCount,
                          capacity: capacity > 0 ? capacity : "∞",
                        })}
                      >
                        {capacity > 0 ? `${signedUpCount}/${capacity}` : "∞"}
                      </Text>
                    </div>
                    <Button
                      size="xs"
                      variant="subtle"
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
          </Stack>
        )}
      </div>
    </Paper>
  );
});
