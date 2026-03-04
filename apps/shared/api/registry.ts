import { z } from "zod";
import { createAnnouncementSchema, updateAnnouncementSchema } from "../schemas/announcement";
import {
  auditLogQuerySchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  createInviteLinkSchema,
} from "../schemas/admin";
import {
  changePasswordSchema,
  changeUsernameSchema,
  loginSchema,
  registerSchema,
} from "../schemas/auth";
import { discordLinkStartSchema, discordLinkVerifySchema, botSettingsSchema } from "../schemas/bot";
import { createEventSchema, updateEventSchema } from "../schemas/event";
import {
  applyWarTemplateSchema,
  createWarTemplateSchema,
  createWarHistorySchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
} from "../schemas/guild-war";
import { createGalleryItemSchema } from "../schemas/gallery";
import { updateProfileSchema } from "../schemas/user";
import {
  createWikiArticleSchema,
  createWikiCategorySchema,
  wikiArticleVersionsQuerySchema,
  wikiVersionCompareQuerySchema,
  updateWikiArticleSchema,
} from "../schemas/wiki";

export type EndpointRole = "member" | "moderator" | "admin";
export type EndpointAuth = "none" | "optional" | "session" | "hmac";
export type EndpointMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type EndpointDefinition<TMethod extends EndpointMethod = EndpointMethod, TRequest = unknown, TResponse = unknown> = {
  method: TMethod;
  path: string;
  auth: EndpointAuth;
  role?: EndpointRole;
  request?: z.ZodType<TRequest>;
  response?: z.ZodType<TResponse>;
  notes?: string;
};

const paginatedQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const usersListQuerySchema = paginatedQuerySchema.extend({
  search: z.string().optional(),
  role: z.enum(["admin", "moderator", "member"]).optional(),
  class: z.string().optional(),
  active: z.coerce.boolean().optional(),
});

const eventsListQuerySchema = paginatedQuerySchema.extend({
  type: z.enum(["weekly_mission", "guild_war", "social", "other"]).optional(),
  archived: z.coerce.boolean().optional(),
  start_after: z.string().datetime().optional(),
  start_before: z.string().datetime().optional(),
});

const announcementsListQuerySchema = paginatedQuerySchema.extend({
  status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
  pinned: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

const guildWarActiveQuerySchema = z.object({
  event_id: z.string().optional(),
});

const guildWarMoveSchema = z.object({
  event_id: z.string(),
  user_id: z.string(),
  from: z.string().optional(),
  to: z.string(),
  etag: z.string().optional(),
});

const guildWarPostResultsSchema = z.object({
  war_history_id: z.string(),
  platform: z.enum(["discord", "wechat"]),
});

const guildWarHistoryQuerySchema = paginatedQuerySchema.extend({
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

const guildWarAnalyticsQuerySchema = z.object({
  war_ids: z.array(z.string()).optional(),
  user_ids: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
});

const guildWarExportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional(),
  event_id: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

const guildWarTemplatesQuerySchema = z.object({
  event_id: z.string().optional(),
});

const wikiArticlesQuerySchema = paginatedQuerySchema.extend({
  category_id: z.string().optional(),
  archived: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

const galleryListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  type: z.enum(["image", "video"]).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const usersParticipantMutationSchema = z.object({
  user_id: z.string(),
});

const adminInviteLinksQuerySchema = z.object({
  include_expired: z.coerce.boolean().optional(),
  include_revoked: z.coerce.boolean().optional(),
});

const adminAuditArchiveMonthSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/),
});

const adminAuditExportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional(),
  entity_type: z.string().optional(),
  actor_id: z.string().optional(),
  search: z.string().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});

const adminRoleUpdateSchema = z.object({
  role: z.enum(["member", "moderator", "admin"]),
});

const adminUserActivationSchema = z.object({
  reason: z.string().max(500).optional(),
});

const adminResetPasswordSchema = z.object({
  temporary_password: z.string().min(8).optional(),
});

const botSignupSchema = z.object({
  event_id: z.string(),
  user_id: z.string(),
  source: z.enum(["discord", "wechat"]).optional(),
});

const botLeaveSchema = z.object({
  event_id: z.string(),
  user_id: z.string(),
  source: z.enum(["discord", "wechat"]).optional(),
});

const botTaskStatusSchema = z.object({
  status: z.enum(["sent", "failed", "queued", "sending"]),
  error: z.string().optional(),
  message_id: z.string().optional(),
});

export const API_REGISTRY = {
  health: {
    method: "GET",
    path: "/api/health",
    auth: "optional",
  },
  websocketConnect: {
    method: "GET",
    path: "/ws",
    auth: "optional",
    notes: "WebSocket upgrade endpoint for push notifications.",
  },

  // Auth
  authLogin: {
    method: "POST",
    path: "/api/auth/login",
    auth: "none",
    request: loginSchema,
  },
  authLogout: {
    method: "POST",
    path: "/api/auth/logout",
    auth: "session",
  },
  authRegister: {
    method: "POST",
    path: "/api/auth/register/:inviteCode",
    auth: "none",
    request: registerSchema,
  },
  authMe: {
    method: "GET",
    path: "/api/auth/me",
    auth: "session",
  },

  // Users / profile
  usersList: {
    method: "GET",
    path: "/api/users",
    auth: "session",
    role: "member",
    request: usersListQuerySchema,
  },
  usersGet: {
    method: "GET",
    path: "/api/users/:id",
    auth: "session",
    role: "member",
  },
  usersProfileUpdate: {
    method: "PATCH",
    path: "/api/users/:id/profile",
    auth: "session",
    role: "member",
    request: updateProfileSchema,
  },
  usersMediaImagesUpload: {
    method: "POST",
    path: "/api/users/:id/media/images",
    auth: "session",
    role: "member",
    notes: "multipart/form-data upload",
  },
  usersMediaImageDelete: {
    method: "DELETE",
    path: "/api/users/:id/media/images/:key",
    auth: "session",
    role: "member",
  },
  usersMediaAudioUpload: {
    method: "POST",
    path: "/api/users/:id/media/audio",
    auth: "session",
    role: "member",
    notes: "multipart/form-data upload",
  },
  usersMediaAudioDelete: {
    method: "DELETE",
    path: "/api/users/:id/media/audio",
    auth: "session",
    role: "member",
  },
  usersChangePassword: {
    method: "POST",
    path: "/api/users/:id/change-password",
    auth: "session",
    role: "member",
    request: changePasswordSchema,
  },
  usersChangeUsername: {
    method: "POST",
    path: "/api/users/:id/change-username",
    auth: "session",
    role: "member",
    request: changeUsernameSchema,
  },
  usersDiscordLinkVerify: {
    method: "POST",
    path: "/api/users/:id/discord-link/verify",
    auth: "session",
    role: "member",
    request: discordLinkVerifySchema,
  },
  usersDiscordUnlink: {
    method: "DELETE",
    path: "/api/users/:id/discord-link",
    auth: "session",
    role: "member",
  },

  // Events
  eventsList: {
    method: "GET",
    path: "/api/events",
    auth: "optional",
    request: eventsListQuerySchema,
  },
  eventsGet: {
    method: "GET",
    path: "/api/events/:id",
    auth: "optional",
  },
  eventsCreate: {
    method: "POST",
    path: "/api/events",
    auth: "session",
    role: "moderator",
    request: createEventSchema,
  },
  eventsUpdate: {
    method: "PATCH",
    path: "/api/events/:id",
    auth: "session",
    role: "moderator",
    request: updateEventSchema,
  },
  eventsDelete: {
    method: "DELETE",
    path: "/api/events/:id",
    auth: "session",
    role: "moderator",
  },
  eventsJoin: {
    method: "POST",
    path: "/api/events/:id/join",
    auth: "session",
    role: "member",
  },
  eventsLeave: {
    method: "DELETE",
    path: "/api/events/:id/leave",
    auth: "session",
    role: "member",
  },
  eventsParticipantAdd: {
    method: "POST",
    path: "/api/events/:id/participants",
    auth: "session",
    role: "moderator",
    request: usersParticipantMutationSchema,
  },
  eventsParticipantRemove: {
    method: "DELETE",
    path: "/api/events/:id/participants/:userId",
    auth: "session",
    role: "moderator",
  },
  eventsUploadImages: {
    method: "POST",
    path: "/api/events/:id/images",
    auth: "session",
    role: "moderator",
  },

  // Announcements
  announcementsList: {
    method: "GET",
    path: "/api/announcements",
    auth: "optional",
    request: announcementsListQuerySchema,
  },
  announcementsGet: {
    method: "GET",
    path: "/api/announcements/:id",
    auth: "optional",
  },
  announcementsCreate: {
    method: "POST",
    path: "/api/announcements",
    auth: "session",
    role: "moderator",
    request: createAnnouncementSchema,
  },
  announcementsUpdate: {
    method: "PATCH",
    path: "/api/announcements/:id",
    auth: "session",
    role: "moderator",
    request: updateAnnouncementSchema,
  },
  announcementsDelete: {
    method: "DELETE",
    path: "/api/announcements/:id",
    auth: "session",
    role: "moderator",
  },
  announcementsImagesUpload: {
    method: "POST",
    path: "/api/announcements/:id/images",
    auth: "session",
    role: "moderator",
    notes: "multipart/form-data upload",
  },

  // Guild war
  guildWarActive: {
    method: "GET",
    path: "/api/guild-war/active",
    auth: "optional",
    request: guildWarActiveQuerySchema,
  },
  guildWarSaveTeams: {
    method: "POST",
    path: "/api/guild-war/save-teams",
    auth: "session",
    role: "moderator",
    request: saveTeamsPayloadSchema,
  },
  guildWarMove: {
    method: "POST",
    path: "/api/guild-war/move",
    auth: "session",
    role: "moderator",
    request: guildWarMoveSchema,
  },
  guildWarHistoryList: {
    method: "GET",
    path: "/api/guild-war/history",
    auth: "optional",
    request: guildWarHistoryQuerySchema,
  },
  guildWarHistoryGet: {
    method: "GET",
    path: "/api/guild-war/history/:id",
    auth: "optional",
  },
  guildWarHistoryCreate: {
    method: "POST",
    path: "/api/guild-war/history",
    auth: "session",
    role: "moderator",
    request: createWarHistorySchema,
  },
  guildWarHistoryUpdate: {
    method: "PATCH",
    path: "/api/guild-war/history/:id",
    auth: "session",
    role: "moderator",
    request: updateWarHistorySchema,
  },
  guildWarHistoryMemberStatsUpdate: {
    method: "PATCH",
    path: "/api/guild-war/history/:id/member-stats/:userId",
    auth: "session",
    role: "moderator",
    request: updateMemberStatsSchema,
  },
  guildWarAnalytics: {
    method: "GET",
    path: "/api/guild-war/analytics",
    auth: "optional",
    request: guildWarAnalyticsQuerySchema,
  },
  guildWarPostResults: {
    method: "POST",
    path: "/api/guild-war/post-results",
    auth: "session",
    role: "moderator",
    request: guildWarPostResultsSchema,
  },
  guildWarExport: {
    method: "GET",
    path: "/api/guild-war/export",
    auth: "optional",
    request: guildWarExportQuerySchema,
  },
  guildWarTemplatesList: {
    method: "GET",
    path: "/api/guild-war/templates",
    auth: "optional",
    request: guildWarTemplatesQuerySchema,
  },
  guildWarTemplateCreate: {
    method: "POST",
    path: "/api/guild-war/templates",
    auth: "session",
    role: "moderator",
    request: createWarTemplateSchema,
  },
  guildWarTemplateApply: {
    method: "POST",
    path: "/api/guild-war/templates/apply",
    auth: "session",
    role: "moderator",
    request: applyWarTemplateSchema,
  },
  guildWarTemplateDelete: {
    method: "DELETE",
    path: "/api/guild-war/templates/:id",
    auth: "session",
    role: "moderator",
  },

  // Wiki
  wikiCategoriesList: {
    method: "GET",
    path: "/api/wiki/categories",
    auth: "optional",
  },
  wikiCategoryCreate: {
    method: "POST",
    path: "/api/wiki/categories",
    auth: "session",
    role: "moderator",
    request: createWikiCategorySchema,
  },
  wikiCategoryUpdate: {
    method: "PATCH",
    path: "/api/wiki/categories/:id",
    auth: "session",
    role: "moderator",
    request: createWikiCategorySchema.partial(),
  },
  wikiCategoryDelete: {
    method: "DELETE",
    path: "/api/wiki/categories/:id",
    auth: "session",
    role: "admin",
  },
  wikiArticlesList: {
    method: "GET",
    path: "/api/wiki/articles",
    auth: "optional",
    request: wikiArticlesQuerySchema,
  },
  wikiArticleGet: {
    method: "GET",
    path: "/api/wiki/articles/:slug",
    auth: "optional",
  },
  wikiArticleVersionsList: {
    method: "GET",
    path: "/api/wiki/articles/:id/versions",
    auth: "optional",
    request: wikiArticleVersionsQuerySchema,
  },
  wikiArticleVersionsCompare: {
    method: "GET",
    path: "/api/wiki/articles/:id/versions/compare",
    auth: "optional",
    request: wikiVersionCompareQuerySchema,
  },
  wikiArticleVersionRollback: {
    method: "POST",
    path: "/api/wiki/articles/:id/versions/:versionId/rollback",
    auth: "session",
    role: "moderator",
  },
  wikiArticleCreate: {
    method: "POST",
    path: "/api/wiki/articles",
    auth: "session",
    role: "moderator",
    request: createWikiArticleSchema,
  },
  wikiArticleUpdate: {
    method: "PATCH",
    path: "/api/wiki/articles/:id",
    auth: "session",
    role: "moderator",
    request: updateWikiArticleSchema,
  },
  wikiArticleDelete: {
    method: "DELETE",
    path: "/api/wiki/articles/:id",
    auth: "session",
    role: "moderator",
  },
  wikiArticleImagesUpload: {
    method: "POST",
    path: "/api/wiki/articles/:id/images",
    auth: "session",
    role: "moderator",
    notes: "multipart/form-data upload",
  },

  // Gallery
  galleryList: {
    method: "GET",
    path: "/api/gallery",
    auth: "optional",
    request: galleryListQuerySchema,
  },
  galleryImagesUpload: {
    method: "POST",
    path: "/api/gallery/images",
    auth: "session",
    role: "member",
    notes: "multipart/form-data upload",
  },
  galleryVideosCreate: {
    method: "POST",
    path: "/api/gallery/videos",
    auth: "session",
    role: "member",
    request: createGalleryItemSchema,
  },
  galleryDelete: {
    method: "DELETE",
    path: "/api/gallery/:id",
    auth: "session",
    role: "moderator",
  },

  // Admin
  adminInviteLinksList: {
    method: "GET",
    path: "/api/admin/invite-links",
    auth: "session",
    role: "moderator",
    request: adminInviteLinksQuerySchema,
  },
  adminInviteLinksStats: {
    method: "GET",
    path: "/api/admin/invite-links/stats",
    auth: "session",
    role: "moderator",
  },
  adminInviteCreate: {
    method: "POST",
    path: "/api/admin/invite-links",
    auth: "session",
    role: "admin",
    request: createInviteLinkSchema,
  },
  adminInviteRevoke: {
    method: "DELETE",
    path: "/api/admin/invite-links/:id",
    auth: "session",
    role: "admin",
    notes: "Soft revoke by setting revoked_at timestamp.",
  },
  adminAuditLog: {
    method: "GET",
    path: "/api/admin/audit-log",
    auth: "session",
    role: "moderator",
    request: auditLogQuerySchema,
  },
  adminAuditLogExport: {
    method: "GET",
    path: "/api/admin/audit-log/export",
    auth: "session",
    role: "moderator",
    request: adminAuditExportQuerySchema,
  },
  adminAuditArchiveMonths: {
    method: "GET",
    path: "/api/admin/audit-archive/months",
    auth: "session",
    role: "admin",
  },
  adminAuditArchiveMonth: {
    method: "GET",
    path: "/api/admin/audit-archive/:month",
    auth: "session",
    role: "admin",
    request: adminAuditArchiveMonthSchema,
  },
  adminUserRoleUpdate: {
    method: "PATCH",
    path: "/api/admin/users/:id/role",
    auth: "session",
    role: "admin",
    request: adminRoleUpdateSchema,
  },
  adminUserDeactivate: {
    method: "PATCH",
    path: "/api/admin/users/:id/deactivate",
    auth: "session",
    role: "admin",
    request: adminUserActivationSchema,
  },
  adminUserReactivate: {
    method: "PATCH",
    path: "/api/admin/users/:id/reactivate",
    auth: "session",
    role: "admin",
    request: adminUserActivationSchema,
  },
  adminUserResetPassword: {
    method: "POST",
    path: "/api/admin/users/:id/reset-password",
    auth: "session",
    role: "admin",
    request: adminResetPasswordSchema,
  },
  adminBatchRoleChange: {
    method: "PATCH",
    path: "/api/admin/users/batch/role",
    auth: "session",
    role: "admin",
    request: batchRoleChangeSchema,
  },
  adminBatchDeactivate: {
    method: "PATCH",
    path: "/api/admin/users/batch/deactivate",
    auth: "session",
    role: "admin",
    request: batchDeactivateSchema,
  },
  adminBatchReactivate: {
    method: "PATCH",
    path: "/api/admin/users/batch/reactivate",
    auth: "session",
    role: "admin",
    request: batchDeactivateSchema,
  },
  adminBatchDelete: {
    method: "PATCH",
    path: "/api/admin/users/batch/delete",
    auth: "session",
    role: "admin",
    request: batchDeactivateSchema,
  },
  adminBotSettingsGet: {
    method: "GET",
    path: "/api/admin/bot-settings",
    auth: "session",
    role: "admin",
  },
  adminBotSettingsUpdate: {
    method: "PATCH",
    path: "/api/admin/bot-settings",
    auth: "session",
    role: "admin",
    request: botSettingsSchema,
  },
  adminStatus: {
    method: "GET",
    path: "/api/admin/status",
    auth: "session",
    role: "admin",
  },

  // Internal bot (HMAC)
  botSignup: {
    method: "POST",
    path: "/internal/bot/signup",
    auth: "hmac",
    request: botSignupSchema,
  },
  botLeave: {
    method: "POST",
    path: "/internal/bot/leave",
    auth: "hmac",
    request: botLeaveSchema,
  },
  botLinkStart: {
    method: "POST",
    path: "/internal/bot/link/start",
    auth: "hmac",
    request: discordLinkStartSchema,
  },
  botLinkVerify: {
    method: "POST",
    path: "/internal/bot/link/verify",
    auth: "hmac",
    request: discordLinkVerifySchema,
  },
  botTaskStatus: {
    method: "PATCH",
    path: "/internal/bot/tasks/:id/status",
    auth: "hmac",
    request: botTaskStatusSchema,
  },
} as const satisfies Record<string, EndpointDefinition>;
