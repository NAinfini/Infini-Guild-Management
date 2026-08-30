export const IMPORTANT_NOTICE_STATUSES = ["draft", "scheduled", "published", "withdrawn"] as const;
export const IMPORTANT_NOTICE_AUDIENCE_SCOPES = ["all", "roles"] as const;
export const MAX_ACTIVE_IMPORTANT_NOTICES = 10;
export const MAX_ACTIVE_IMPORTANT_NOTICE_BODY_CHARACTERS = 2_000_000;

export type ImportantNoticeStatus = (typeof IMPORTANT_NOTICE_STATUSES)[number];
export type ImportantNoticeAudienceScope = (typeof IMPORTANT_NOTICE_AUDIENCE_SCOPES)[number];
