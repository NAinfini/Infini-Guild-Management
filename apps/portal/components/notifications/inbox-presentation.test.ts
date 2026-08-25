import type { InboxNotification, InboxNotificationListResponse } from "@guild/shared";
import { describe, expect, it } from "vitest";
import {
  flattenInboxNotifications,
  getInboxNotificationPresentation,
} from "./inbox-presentation";

const announcement: InboxNotification = {
  id: "notification-1",
  kind: "announcement_published",
  entity_type: "announcement",
  entity_id: "announcement-1",
  occurred_at: "2026-08-24T12:00:00.000Z",
  read_at: null,
  payload: { title: "Raid briefing" },
};

describe("inbox presentation", () => {
  it("deduplicates shared inbox pages without changing their chronology", () => {
    const page = (data: InboxNotification[]): InboxNotificationListResponse => ({
      data,
      next_cursor: null,
      unread_count: 1,
    });

    expect(flattenInboxNotifications({ pages: [page([announcement]), page([announcement])] }))
      .toEqual([announcement]);
  });

  it("derives activity copy only from the real notification payload", () => {
    const presentation = getInboxNotificationPresentation(announcement, (key) => key);

    expect(presentation).toEqual({
      badgeKey: "notification.type.announcement",
      titleKey: "notification.title.announcement_published",
      detail: "Raid briefing",
      tone: "announcement",
    });
  });
});
