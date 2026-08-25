export const IMPORTANT_NOTICE_STATUSES = ["draft", "scheduled", "published", "withdrawn"] as const;

export type ImportantNoticeStatus = (typeof IMPORTANT_NOTICE_STATUSES)[number];
