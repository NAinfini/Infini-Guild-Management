import type { Announcement } from "@guild/shared";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { NotificationOutlined } from "../../utils/icons";
import { EmptyState } from "../shared/EmptyState";
import { cardHeading } from "./shared";

type NotificationsCardProps = {
  announcements: Announcement[];
  unreadCount: number;
  onMarkAllAsRead: () => void;
  onOpenAnnouncementList: () => void;
};

export function NotificationsCard({
  announcements,
  unreadCount,
  onMarkAllAsRead,
  onOpenAnnouncementList,
}: NotificationsCardProps) {
  const { t } = useTranslation("dashboard");

  return (
    <InfiniCard className="dashboard-card" interactive={false} overrides={{ glow: { variant: "spotlight", glowIntensity: 0.2 } }}>
        <Group justify="space-between" align="center">
          {cardHeading(t("card.notifications.title"), <NotificationOutlined size={18} />)}
          <Button
            variant="subtle"
            size="compact-xs"
            className="dashboard-notifications-mark-read-btn"
            onClick={onMarkAllAsRead}
            disabled={unreadCount === 0}
          >
            Mark All as Read
          </Button>
        </Group>

        <Stack className="dashboard-notifications" gap={8} mt={10}>
          {announcements.length === 0 ? (
            <EmptyState title={t("empty")} />
          ) : (
            announcements.map((item) => (
              <Button
                key={item.id}
                fullWidth
                variant="subtle"
                className="dashboard-notification-button"
                onClick={onOpenAnnouncementList}
              >
                <div className="dashboard-notification-row">
                  <Stack gap={2} align="flex-start">
                    <Text fw={700}>{item.title}</Text>
                    <Group gap={8}>
                      <Badge variant="light">{item.status}</Badge>
                      {item.pinned ? <Badge color="infini-warning">PINNED</Badge> : null}
                    </Group>
                  </Stack>
                  <Text c="dimmed" className="dashboard-notification-time">
                    {item.updated_at ? formatDistanceToNow(new Date(item.updated_at), { addSuffix: true }) : "-"}
                  </Text>
                </div>
              </Button>
            ))
          )}
        </Stack>
    </InfiniCard>
  );
}

