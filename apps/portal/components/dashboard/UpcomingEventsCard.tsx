import type { Event } from "@guild/shared";
import { activeGame } from "@guild/shared/games";
import { NumberTicker } from "@portal/components/effects";
import { PortalCard } from "../shared/PortalCard";
import { Badge, Button, Group, RingProgress, Stack, Text } from "@mantine/core";
import { MemberRoleAvatar } from "../shared/MemberRoleAvatar";
import { ArrowRightIcon, CalendarEventIcon, ClockIcon, FriendsIcon, SwordsIcon, TargetArrowIcon } from "@portal/components/icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import {
  cardHeading,
  eventTypeTagColor,
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
};

export const UpcomingEventsCard = memo(function UpcomingEventsCard({
  upcomingEventsCount,
  featuredRows,
  rows,
  onOpenEvent,
}: UpcomingEventsCardProps) {
  const { t, i18n } = useTranslation("dashboard");
  const safeUpcomingCount = Math.max(0, upcomingEventsCount);
  const hasAnyRows = featuredRows.length > 0 || rows.length > 0;

  return (
    <PortalCard className="dashboard-card" interactive={false}>
      {/* The count used to sit under the heading as its own xl line, repeating what
          the list below already shows. It rides along with the heading now. */}
      <Group gap={8} align="center" wrap="nowrap" justify="space-between">
        {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Badge size="sm" variant="light" color="gray" style={{ flexShrink: 0 }}>
            <NumberTicker value={safeUpcomingCount} /> {t("card.upcomingEvents.unit")}
          </Badge>
        ) : null}
      </Group>
        {!hasAnyRows ? (
          <EmptyState title={t("empty")} />
        ) : (
          <Stack gap={8} mt={12}>
            {[...featuredRows, ...rows].slice(0, 5).map((item) => {
              const signedUpCount = item.members.length;
              const capacity = item.item.capacity ?? 0;
              const percentage = capacity > 0 ? Math.round((signedUpCount / capacity) * 100) : 0;
              const startDate = new Date(item.item.start_at);
              const month = startDate.toLocaleString(i18n.language, { month: "short" }).toUpperCase();
              const day = startDate.getDate();

              return (
                <div
                  key={item.item.id}
                  style={{
                    padding: "14px",
                    background: "color-mix(in srgb, var(--color-surface, #fff) 97%, var(--color-text, #1A1815))",
                    borderRadius: "12px",
                    border: "1px solid var(--border-subtle)",
                    transition: "border-color 160ms ease, box-shadow 160ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-strong)";
                    e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <Group gap={12} wrap="nowrap" align="center">
                    <Stack gap={0} align="center" style={{ minWidth: 50 }}>
                      <Text size="xs" c="dimmed" fw={600}>{month}</Text>
                      <Text size="xl" fw={700}>{day}</Text>
                    </Stack>
                    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={600} size="sm" truncate>{item.item.title}</Text>
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
                      </Group>
                    </Stack>
                      {/* Ten 48px avatars ate the row and truncated the event title to
                          "Weekly Missio…". Six smaller ones leave the title readable. */}
                      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                        {item.members.slice(0, 6).map((member) => (
                          <MemberRoleAvatar key={member.user.id} user={member.user} profile={member.profile} size={36} />
                        ))}
                      {item.members.length > 6 ? (
                        <Text size="xs" c="dimmed" fw={600}>
                          +{item.members.length - 6}
                        </Text>
                      ) : null}
                    </Group>
                    <Stack gap={2} align="center">
                      <RingProgress
                        size={36}
                        thickness={4}
                        roundCaps
                        sections={[{ value: percentage, color: "var(--color-primary, #D4A843)" }]}
                      />
                      <Text size="10px" ta="center" fw={600} c="dimmed">
                        {capacity > 0 ? `${signedUpCount}/${capacity}` : "∞"}
                      </Text>
                    </Stack>
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
    </PortalCard>
  );
});
