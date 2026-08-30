export const ANNOUNCEMENT_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_CATEGORIES = [
  "announcement",
  "event",
  "war",
  "important",
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
