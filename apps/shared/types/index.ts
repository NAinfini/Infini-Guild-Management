import type { z } from "zod";
import type { PushEntityType, PushHint } from "../constants/push-hints";
import type { userSchema, memberProfileSchema } from "../schemas/user";
import type { eventSchema, eventClassQuotaSchema, eventClassQuotaInputSchema, eventParticipantSchema, eventPollSchema, eventRaffleWinnerSchema, recurringTemplateSchema } from "../schemas/event";
import type { announcementSchema } from "../schemas/announcement";
import type {
  guildWarActiveResponseSchema,
  warHistorySchema,
  warTeamSchema,
  warTeamMemberSchema,
} from "../schemas/guild-war";
import type { wikiCategorySchema, wikiArticleSchema, wikiRevisionListItemSchema, wikiRevisionSchema } from "../schemas/wiki";
import type { galleryItemSchema } from "../schemas/gallery";
import type {
  inviteLinkSchema,
  inviteLinkStatsSchema,
  auditLogSchema,
  adminRoleSchema,
  rolePermissionsSchema,
} from "../schemas/admin";
import type {
  memberBadgeSchema,
  userBadgeSchema,
  badgeAssignmentSchema,
  reorderMemberBadgesSchema,
} from "../schemas/badge";

export type User = z.infer<typeof userSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EventParticipant = z.infer<typeof eventParticipantSchema>;
export type EventClassQuota = z.infer<typeof eventClassQuotaSchema>;
/** 提交给服务端的那一格：只有标签 id 和人数，标签本身的内容不在这里复制。 */
export type EventClassQuotaInput = z.infer<typeof eventClassQuotaInputSchema>;
export type EventPoll = z.infer<typeof eventPollSchema>;
export type EventRaffleWinner = z.infer<typeof eventRaffleWinnerSchema>;
export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type WarHistory = z.infer<typeof warHistorySchema>;
export type WarTeam = z.infer<typeof warTeamSchema>;
export type WarTeamMember = z.infer<typeof warTeamMemberSchema>;
export type GuildWarActiveResponse = z.infer<typeof guildWarActiveResponseSchema>;
export type WikiCategory = z.infer<typeof wikiCategorySchema>;
export type WikiArticle = z.infer<typeof wikiArticleSchema>;
export type WikiRevisionListItem = z.infer<typeof wikiRevisionListItemSchema>;
export type WikiRevision = z.infer<typeof wikiRevisionSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type InviteLink = z.infer<typeof inviteLinkSchema>;
export type InviteLinkStats = z.infer<typeof inviteLinkStatsSchema>;
export type AuditLogEntry = z.infer<typeof auditLogSchema>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;
export type MemberBadge = z.infer<typeof memberBadgeSchema>;
export type UserBadge = z.infer<typeof userBadgeSchema>;
export type BadgeAssignment = z.infer<typeof badgeAssignmentSchema>;
export type ReorderMemberBadgesInput = z.infer<typeof reorderMemberBadgesSchema>;

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

export type EntityChangedPushMessage = {
  type: "entity_changed";
  entity_type: PushEntityType;
  entity_id: string;
  updated_at: string;
  hint: PushHint;
  display_name?: string;
};

export type MemberOnlinePushMessage = {
  type: "member_online";
  user_id: string;
  source: "portal";
  online_at: string;
};

export type AnnouncementPublishedPushMessage = {
  type: "announcement_published";
  announcement_id: string;
  title: string;
  published_at: string;
};

export type HeartbeatMessage = {
  type: "heartbeat";
  tab_id: string;
  seq: number;
  sent_at: string;
};

export type HeartbeatAckMessage = {
  type: "heartbeat_ack";
  tab_id: string;
  seq: number;
  server_at: string;
  connections: number;
};

export type PushMessage =
  | EntityChangedPushMessage
  | MemberOnlinePushMessage
  | AnnouncementPublishedPushMessage
  | HeartbeatAckMessage;
