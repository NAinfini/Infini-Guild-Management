import type { z } from "zod";
import type {
  announcementPublishedPushMessageSchema,
  entityChangedPushMessageSchema,
  heartbeatAckMessageSchema,
  heartbeatMessageSchema,
  inboxChangedPushMessageSchema,
  inboxNotificationListResponseSchema,
  inboxNotificationSchema,
  inboxNotificationUnreadCountResponseSchema,
  memberOnlinePushMessageSchema,
  pushMessageSchema,
} from "../schemas/notifications";
import type {
  importantNoticeActiveSchema,
  importantNoticeAudienceRoleSchema,
  importantNoticeSchema,
} from "../schemas/important-notices";
import type { userSchema, memberSummarySchema, memberProfileSchema, userDetailResponseSchema, memberDirectoryEntrySchema, memberPlanningEntrySchema, memberListSortSchema, memberManagementStatsSchema, usersListResponseSchema, memberDirectoryResponseSchema, memberAvailabilitySummarySchema } from "../schemas/user";
import type { eventSchema, eventClassQuotaSchema, eventClassQuotaInputSchema, eventParticipantSchema, eventPollSchema, eventRaffleWinnerSchema, recurringTemplateSchema } from "../schemas/event";
import type {
  announcementAttachmentSchema,
  announcementSchema,
  announcementSummarySchema,
} from "../schemas/announcement";
import type {
  guildWarActiveResponseSchema,
  guildWarHistoryDetailResponseSchema,
  guildWarMemberResponseSchema,
  warHistorySchema,
  warTeamSchema,
  warTeamMemberSchema,
} from "../schemas/guild-war";
import type { wikiCategorySchema, wikiArticleSchema, wikiRevisionListItemSchema, wikiRevisionSchema } from "../schemas/wiki";
import type { galleryItemSchema } from "../schemas/gallery";
import type {
  inviteLinkSchema,
  inviteLinkStatsSchema,
  auditActorSchema,
  auditChangeSchema,
  auditContextSchema,
  auditEventSchema,
  auditPayloadV2Schema,
  auditSubjectSchema,
  auditValueSchema,
  adminRoleSchema,
  rolePermissionsSchema,
} from "../schemas/admin";
import type {
  memberBadgeSchema,
  userBadgeSchema,
  badgeAssignmentSchema,
  badgeAssignmentsListQuerySchema,
  reorderMemberBadgesSchema,
} from "../schemas/badge";

export type User = z.infer<typeof userSchema>;
export type MemberSummary = z.infer<typeof memberSummarySchema>;
export type UserDetailResponse = z.infer<typeof userDetailResponseSchema>;
export type MemberDirectoryEntry = z.infer<typeof memberDirectoryEntrySchema>;
export type MemberPlanningEntry = z.infer<typeof memberPlanningEntrySchema>;
export type MemberListSort = z.infer<typeof memberListSortSchema>;
export type MemberManagementStats = z.infer<typeof memberManagementStatsSchema>;
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;
export type MemberDirectoryResponse = z.infer<typeof memberDirectoryResponseSchema>;
export type MemberAvailabilitySummary = z.infer<typeof memberAvailabilitySummarySchema>;
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
export type AnnouncementSummary = z.infer<typeof announcementSummarySchema>;
export type AnnouncementAttachment = z.infer<typeof announcementAttachmentSchema>;
export type WarHistory = z.infer<typeof warHistorySchema>;
export type WarTeam = z.infer<typeof warTeamSchema>;
export type WarTeamMember = z.infer<typeof warTeamMemberSchema>;
export type GuildWarActiveResponse = z.infer<typeof guildWarActiveResponseSchema>;
export type GuildWarHistoryDetailResponse = z.infer<typeof guildWarHistoryDetailResponseSchema>;
export type GuildWarMemberResponse = z.infer<typeof guildWarMemberResponseSchema>;
export type WikiCategory = z.infer<typeof wikiCategorySchema>;
export type WikiArticle = z.infer<typeof wikiArticleSchema>;
export type WikiRevisionListItem = z.infer<typeof wikiRevisionListItemSchema>;
export type WikiRevision = z.infer<typeof wikiRevisionSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type InviteLink = z.infer<typeof inviteLinkSchema>;
export type InviteLinkStats = z.infer<typeof inviteLinkStatsSchema>;
export type AuditValue = z.infer<typeof auditValueSchema>;
export type AuditChange = z.infer<typeof auditChangeSchema>;
export type AuditContext = z.infer<typeof auditContextSchema>;
export type AuditPayloadV2 = z.infer<typeof auditPayloadV2Schema>;
export type AuditActor = z.infer<typeof auditActorSchema>;
export type AuditSubject = z.infer<typeof auditSubjectSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AdminRole = z.infer<typeof adminRoleSchema>;
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;
export type MemberBadge = z.infer<typeof memberBadgeSchema>;
export type UserBadge = z.infer<typeof userBadgeSchema>;
export type BadgeAssignment = z.infer<typeof badgeAssignmentSchema>;
export type BadgeAssignmentsListQuery = z.infer<typeof badgeAssignmentsListQuerySchema>;
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

export type EntityChangedPushMessage = z.infer<typeof entityChangedPushMessageSchema>;
export type MemberOnlinePushMessage = z.infer<typeof memberOnlinePushMessageSchema>;
export type AnnouncementPublishedPushMessage = z.infer<typeof announcementPublishedPushMessageSchema>;
export type HeartbeatMessage = z.infer<typeof heartbeatMessageSchema>;
export type HeartbeatAckMessage = z.infer<typeof heartbeatAckMessageSchema>;
export type InboxChangedPushMessage = z.infer<typeof inboxChangedPushMessageSchema>;
export type InboxNotification = z.infer<typeof inboxNotificationSchema>;
export type InboxNotificationListResponse = z.infer<typeof inboxNotificationListResponseSchema>;
export type InboxNotificationUnreadCountResponse = z.infer<typeof inboxNotificationUnreadCountResponseSchema>;
export type PushMessage = z.infer<typeof pushMessageSchema>;
export type ImportantNotice = z.infer<typeof importantNoticeSchema>;
export type ImportantNoticeActive = z.infer<typeof importantNoticeActiveSchema>;
export type ImportantNoticeAudienceRole = z.infer<typeof importantNoticeAudienceRoleSchema>;
