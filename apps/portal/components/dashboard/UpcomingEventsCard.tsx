import type { Event } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { MemberAvatarStack } from "../shared/MemberAvatarStack";
import { ArrowRightIcon, CalendarEventIcon, ClockIcon, FriendsIcon, SwordsIcon, TargetArrowIcon } from "@portal/components/icons";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EventQuotaBar } from "../feature/events/EventQuotaBar";
import { EmptyState } from "../shared/EmptyState";
import {
  cardHeading,
  eventTypeTagColor,
  orderDashboardUpcomingRows,
  type DashboardUpcomingEventRow,
} from "./shared";

const ICON_COMPONENT_MAP: Record<string, React.ReactNode> = {
  TargetOutlined: <TargetArrowIcon size={12} />,
  SwordsOutlined: <SwordsIcon size={12} />,
  TeamOutlined: <FriendsIcon size={12} />,
  CalendarEventOutlined: <CalendarEventIcon size={12} />,
};

const EVENT_TYPE_ICON: Record<string, React.ReactNode> = Object.fromEntries(
  activeGame.eventTypes.map((et) => [et.id, ICON_COMPONENT_MAP[et.icon] ?? <CalendarEventIcon size={12} />]),
);

function eventTypeIcon(type: string): React.ReactNode {
  return EVENT_TYPE_ICON[type] ?? <CalendarEventIcon size={12} />;
}

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
    <Paper withBorder radius="md" className="dashboard-card">
      <div>
      {/* The count used to sit under the heading as its own xl line, repeating what
          the list below already shows. It rides along with the heading now. */}
      <Group gap={8} align="center" wrap="nowrap" justify="space-between">
        {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" variant="light" color="gray" style={{ flexShrink: 0 }}>
              {safeUpcomingCount} {t("card.upcomingEvents.unit")}
            </Badge>
            <Button size="xs" variant="subtle" onClick={onViewAll}>
              {t("card.upcomingEvents.viewAll", { count: safeUpcomingCount })}
            </Button>
          </Group>
        ) : null}
      </Group>
        {!hasAnyRows ? (
          <EmptyState title={t("empty")} />
        ) : (
          <Stack gap={8} mt={12}>
            {orderedRows.map((item) => {
              const signedUpCount = item.members.length;
              const capacity = item.item.capacity ?? 0;
              const startDate = new Date(item.item.start_at);
              const month = startDate.toLocaleString(i18n.language, { month: "short" }).toUpperCase();
              const day = startDate.getDate();

              return (
                <div key={item.item.id} className="upcoming-event-row">
                  <Group gap={12} wrap="nowrap" align="center">
                    <Stack gap={0} align="center" style={{ minWidth: 50 }}>
                      <Text size="xs" c="dimmed" fw={600}>{month}</Text>
                      <Text size="xl" fw={700}>{day}</Text>
                    </Stack>
                    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
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
                        <Badge size="xs" color={eventTypeTagColor(item.item.type)} variant="light" leftSection={eventTypeIcon(item.item.type)}>
                          {t(`common:eventType.${item.item.type}`)}
                        </Badge>
                        <Group gap={4}>
                          <ClockIcon size={12} style={{ opacity: 0.6 }} />
                          <Text size="xs" c="dimmed">
                            {startDate.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </Text>
                        </Group>
                        {/* 「还缺什么职业」跟活动卡上是同一行筹码：面板是大多数人每天
                            唯一会看的一页，缺人只在活动页显示等于没人看得见。 */}
                        {/* 面板这一行右边已经有容量数字了，没配额时再画一条报名进度是
                            同一件事说两遍，所以这里只在真有配额时渲染。 */}
                        {item.quotaSummary ? (
                          <EventQuotaBar
                            summary={item.quotaSummary}
                            event={item.item}
                            participantCount={item.members.length}
                          />
                        ) : null}
                      </Group>
                    </Stack>
                    {/* 跟活动卡用同一摞头像：叠着放、不挂职业圈，不再让一排头像把标题挤成
                        "Weekly Missio…"。 */}
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
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => onOpenEvent(item.item)}
                      style={{ minWidth: 32, padding: "4px 8px" }}
                      aria-label={t("card.upcomingEvents.viewEvent")}
                    >
                      <ArrowRightIcon size={16} />
                    </Button>
                  </Group>
                </div>
              );
            })}
          </Stack>
        )}
      </div>
    </Paper>
  );
});
