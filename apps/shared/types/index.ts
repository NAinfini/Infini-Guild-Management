import type { z } from "zod";
import type { userSchema, memberProfileSchema } from "../schemas/user";
import type { eventSchema, eventParticipantSchema } from "../schemas/event";
import type { announcementSchema } from "../schemas/announcement";
import type {
  warHistorySchema,
  warTemplateSchema,
  warTeamSchema,
  warTeamMemberSchema,
} from "../schemas/guild-war";
import type { wikiCategorySchema, wikiArticleSchema, wikiArticleVersionSchema } from "../schemas/wiki";
import type { galleryItemSchema } from "../schemas/gallery";
import type { inviteLinkSchema, inviteLinkStatsSchema, auditLogSchema } from "../schemas/admin";
import type { botTaskSchema, botSettingsSchema } from "../schemas/bot";

export type User = z.infer<typeof userSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EventParticipant = z.infer<typeof eventParticipantSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type WarHistory = z.infer<typeof warHistorySchema>;
export type WarTemplate = z.infer<typeof warTemplateSchema>;
export type WarTeam = z.infer<typeof warTeamSchema>;
export type WarTeamMember = z.infer<typeof warTeamMemberSchema>;
export type WikiCategory = z.infer<typeof wikiCategorySchema>;
export type WikiArticle = z.infer<typeof wikiArticleSchema>;
export type WikiArticleVersion = z.infer<typeof wikiArticleVersionSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type InviteLink = z.infer<typeof inviteLinkSchema>;
export type InviteLinkStats = z.infer<typeof inviteLinkStatsSchema>;
export type AuditLogEntry = z.infer<typeof auditLogSchema>;
export type BotTask = z.infer<typeof botTaskSchema>;
export type BotSettings = z.infer<typeof botSettingsSchema>;

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export type CursorResponse<T> = {
  data: T[];
  next_cursor: string | null;
};

export type ApiError = {
  error_code: string;
  message: string;
  request_id: string;
  details?: unknown;
};

export type EntityChangedPushMessage = {
  type: "entity_changed";
  entity_type: string;
  entity_id: string;
  updated_at: string;
  hint: string;
};

export type MemberOnlinePushMessage = {
  type: "member_online";
  user_id: string;
  source: "portal" | "discord" | "wechat";
  online_at: string;
};

export type EventReminderPushMessage = {
  type: "event_reminder";
  event_id: string;
  title: string;
  starts_at: string;
  platforms: Array<"discord" | "wechat">;
  generated_at: string;
};

export type AnnouncementPublishedPushMessage = {
  type: "announcement_published";
  announcement_id: string;
  title: string;
  published_at: string;
};

export type PushMessage =
  | EntityChangedPushMessage
  | MemberOnlinePushMessage
  | EventReminderPushMessage
  | AnnouncementPublishedPushMessage;

export type RoleLevel = { admin: 3; moderator: 2; member: 1 };
