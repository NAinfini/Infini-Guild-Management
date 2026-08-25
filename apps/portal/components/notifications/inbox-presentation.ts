import type { InboxNotification, InboxNotificationListResponse } from "@guild/shared";
import { formatDateTime } from "../../utils/datetime";

export type InboxNotificationTone = "member" | "announcement" | "event" | "wiki";

export type InboxNotificationPresentation = {
  badgeKey: string;
  titleKey: string;
  detail: string;
  tone: InboxNotificationTone;
};

export function flattenInboxNotifications(
  current: { pages: readonly InboxNotificationListResponse[] } | undefined,
): InboxNotification[] {
  const notifications = new Map<string, InboxNotification>();
  for (const page of current?.pages ?? []) {
    for (const notification of page.data) {
      if (!notifications.has(notification.id)) notifications.set(notification.id, notification);
    }
  }
  return [...notifications.values()];
}

export function getInboxNotificationPresentation(
  item: InboxNotification,
  t: (key: string, options?: Record<string, unknown>) => string,
): InboxNotificationPresentation {
  switch (item.kind) {
    case "member_joined":
      return {
        badgeKey: "notification.type.member",
        titleKey: "notification.title.member_joined",
        detail: t("notification.message.member_joined", { displayName: item.payload.display_name }),
        tone: "member",
      };
    case "announcement_published":
      return {
        badgeKey: "notification.type.announcement",
        titleKey: "notification.title.announcement_published",
        detail: item.payload.title,
        tone: "announcement",
      };
    case "event_created":
      return {
        badgeKey: "notification.type.eventReminder",
        titleKey: "notification.title.event_created",
        detail: t("notification.message.event_created", {
          title: item.payload.title,
          startAt: formatDateTime(item.payload.start_at),
        }),
        tone: "event",
      };
    case "wiki_article_created":
      return {
        badgeKey: "notification.type.wiki",
        titleKey: "notification.title.article_created",
        detail: item.payload.title,
        tone: "wiki",
      };
  }
}
