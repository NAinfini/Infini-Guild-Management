import { NotificationOutlined } from "../../utils/icons";
import {
  ActionIcon,
  Badge,
  Group,
  HoverCard,
  Indicator,
  Popover,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { TrashIcon } from "@portal/components/icons";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../shared/EmptyState";

type PushEntry = {
  id: string;
  title: string;
  message: string;
  type: string;
  readAt: string | null;
  occurredAt: string;
};

type NotificationPopoverProps = {
  user: unknown;
  pushHasUnread: boolean;
  notificationAnnouncementsHasNew: boolean;
  displayPushEntries: PushEntry[];
  onClose: () => void;
  onClearHistory: () => void;
  onEntryClick: (entryId: string, type: string) => void;
};

export function NotificationPopover({
  user,
  pushHasUnread,
  notificationAnnouncementsHasNew,
  displayPushEntries,
  onClose,
  onClearHistory,
  onEntryClick,
}: NotificationPopoverProps) {
  const { t } = useTranslation("common");

  return (
    <Popover width={420} position="bottom-end" shadow="md" withArrow trapFocus onClose={onClose}>
      <Popover.Target>
        <ActionIcon variant="subtle" className="app-header-icon-btn" aria-label={pushHasUnread ? t("label.notificationsUnread") : t("label.notifications")}>
          <Indicator
            disabled={
              !Boolean(
                user &&
                  (pushHasUnread ||
                    notificationAnnouncementsHasNew),
              )
            }
            offset={1}
            size={8}
            inline
          >
            <NotificationOutlined />
          </Indicator>
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown className="app-header-notifications-popover">
        <div className="app-header-notifications-overlay">
          <div className="app-header-notifications-head">
            <Text fw={600}>{t("label.notifications")}</Text>
            {displayPushEntries.length > 0 && (
              <HoverCard width={240} shadow="lg" withArrow arrowSize={10} openDelay={350} closeDelay={80} position="bottom-end">
                <HoverCard.Target>
                  <ActionIcon variant="subtle" size="sm" onClick={onClearHistory} aria-label={t("action.clearNotifications")}>
                    <TrashIcon size={14} />
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown p="sm" style={{ borderRadius: 10 }}>
                  <Group gap={10} wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color="red" size="lg" radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                      <TrashIcon size={16} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={700} lh={1.3} mb={4}>{t("action.clearNotifications")}</Text>
                      <Text size="xs" c="dimmed" lh={1.5}>{t("notification.tooltip.clearAll")}</Text>
                    </div>
                  </Group>
                </HoverCard.Dropdown>
              </HoverCard>
            )}
          </div>

          {displayPushEntries.length === 0 ? (
            <EmptyState title={t("notification.empty")} />
          ) : (
            <Stack gap={6} className="app-header-notifications-list">
              {displayPushEntries.map((item) => (
                <UnstyledButton
                  key={item.id}
                  className={`app-header-notification-item ${
                    item.readAt === null ? "app-header-notification-item--unread" : ""
                  }`}
                  onClick={() => onEntryClick(item.id, item.type)}
                >
                  <div className="app-header-notification-row">
                    <Stack gap={4} align="flex-start">
                      <Group gap={8} wrap="nowrap">
                        <Text fw={600}>{item.title}</Text>
                        {item.type === "announcement_published" ? (
                          <Badge variant="light" color="blue">
                            {t("notification.type.announcement")}
                          </Badge>
                        ) : item.type === "event_changed" ? (
                          <Badge variant="light" color="orange">
                            {t("notification.type.eventReminder")}
                          </Badge>
                        ) : item.type === "wiki_changed" ? (
                          <Badge variant="light" color="teal">
                            {t("notification.type.wiki")}
                          </Badge>
                        ) : item.type === "member_joined" ? (
                          <Badge variant="light" color="green">
                            {t("notification.type.memberOnline")}
                          </Badge>
                        ) : null}
                      </Group>
                      <Group gap={8}>
                        <Text c="dimmed" size="sm">
                          {item.message}
                        </Text>
                      </Group>
                    </Stack>
                    <Text c="dimmed" className="app-header-notification-time">
                      {formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true })}
                    </Text>
                  </div>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
