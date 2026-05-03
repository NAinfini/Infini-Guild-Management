import type { PushMessage } from "@guild/shared";
import { NotificationOutlined } from "../../utils/icons";
import {
  ActionIcon,
  Badge,
  Group,
  Indicator,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../shared/EmptyState";

type PushEntry = {
  id: string;
  title: string;
  message: string;
  type: PushMessage["type"];
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
  onEntryClick: (entryId: string, type: PushMessage["type"]) => void;
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
              <ActionIcon variant="subtle" size="sm" onClick={onClearHistory} aria-label={t("action.clearNotifications")}>
                <IconTrash size={14} />
              </ActionIcon>
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
