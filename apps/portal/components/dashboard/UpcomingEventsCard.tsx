import type { Event } from "@guild/shared";
import { NumberTicker } from "@portal/components/effects";
import { PortalCard } from "../shared/PortalCard";
import { Badge, Button, Group, RingProgress, Stack, Text } from "@mantine/core";
import { MemberRoleAvatar } from "../shared/MemberRoleAvatar";
import { CalendarEventIcon, SwordsIcon } from "@portal/components/icons";
import {
  IconArrowRight,
  IconClock,
  IconFriends,
  IconTargetArrow,
} from "@tabler/icons-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarEventOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import {
  cardHeading,
  eventTypeTagColor,
  type DashboardUpcomingEventRow,
} from "./shared";

const EVENT_TYPE_ICON: Record<string, React.ReactNode> = {
  weekly_mission: <IconTargetArrow size={12} />,
  guild_war: <SwordsIcon size={12} />,
  social: <IconFriends size={12} />,
  other: <CalendarEventIcon size={12} />,
};

function eventTypeIcon(type: string): React.ReactNode {
  return EVENT_TYPE_ICON[type] ?? EVENT_TYPE_ICON.other;
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
      {cardHeading(t("card.upcomingEvents.title"), <CalendarEventOutlined size={18} />)}
        {safeUpcomingCount > 0 ? (
          <Text size="xl" fw={700} mt={8}>
            <NumberTicker value={safeUpcomingCount} /> {t("card.upcomingEvents.unit")}
          </Text>
        ) : null}
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
                    background: "color-mix(in srgb, var(--color-surface, #fff) 97%, var(--color-text, #111827))",
                    borderRadius: "12px",
                    border: "1px solid color-mix(in srgb, var(--color-text, #111827) 6%, transparent)",
                    transition: "border-color 160ms ease, box-shadow 160ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-primary, #3b82f6) 24%, transparent)";
                    e.currentTarget.style.boxShadow = "0 2px 8px color-mix(in srgb, var(--color-primary, #3b82f6) 6%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-text, #111827) 6%, transparent)";
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
                          <IconClock size={12} style={{ opacity: 0.6 }} />
                          <Text size="xs" c="dimmed">
                            {startDate.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </Text>
                        </Group>
                      </Group>
                    </Stack>
                      <Group gap={4}>
                        {item.members.slice(0, 10).map((member) => (
                          <MemberRoleAvatar key={member.user.id} user={member.user} profile={member.profile} size={44} />
                        ))}
                      {item.members.length > 10 ? (
                        <Text size="xs" c="dimmed" fw={600}>
                          +{item.members.length - 10}
                        </Text>
                      ) : null}
                    </Group>
                    <Stack gap={2} align="center">
                      <RingProgress
                        size={44}
                        thickness={4}
                        roundCaps
                        sections={[{ value: percentage, color: "var(--color-primary, #3b82f6)" }]}
                        label={
                          <Text size="10px" ta="center" fw={600}>
                            {capacity > 0 ? `${signedUpCount}/${capacity}` : "∞"}
                          </Text>
                        }
                      />
                    </Stack>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => onOpenEvent(item.item)}
                      style={{ minWidth: 32, padding: "4px 8px" }}
                      aria-label={t("card.upcomingEvents.viewEvent")}
                    >
                      <IconArrowRight size={16} />
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
