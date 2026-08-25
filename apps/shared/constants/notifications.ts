export const INBOX_NOTIFICATION_KINDS = [
  "member_joined",
  "announcement_published",
  "event_created",
  "wiki_article_created",
] as const;

export type InboxNotificationKind = (typeof INBOX_NOTIFICATION_KINDS)[number];

export const INBOX_NOTIFICATION_ENTITY_TYPES = [
  "member",
  "announcement",
  "event",
  "wiki_article",
] as const;

export type InboxNotificationEntityType = (typeof INBOX_NOTIFICATION_ENTITY_TYPES)[number];

export const NOTIFICATION_INBOX_RETENTION_DAYS = 3;
