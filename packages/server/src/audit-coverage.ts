import type { AuditAction, AuditEntityType } from "@guild/shared/constants/audit";
import type { ScheduledJobName } from "./modules/jobs/public.js";

type AuditedOperation = Readonly<{
  classification: "audited";
  operation: string;
  source: string;
  subjectType: AuditEntityType;
  actions: readonly AuditAction[];
  transactionOwner: string;
  scheduledJob?: ScheduledJobName;
}>;

type RuntimeExemption = Readonly<{
  classification: "runtime_exemption";
  operation: string;
  source: string;
  reason: string;
  scheduledJob?: ScheduledJobName;
}>;

export type AuditCoverageEntry = AuditedOperation | RuntimeExemption;

export const AUDIT_COVERAGE = [
  audited("IdentityAdminService.invites", "auth/identity-admin-service.ts", "invite_link", ["create", "revoke", "delete"], "AuthStore transaction"),
  audited("IdentityAdminService.users", "auth/identity-admin-service.ts", "user", ["admin_create_member", "update_role", "deactivate", "reactivate", "batch_role_update", "batch_deactivate", "batch_reactivate"], "AuthStore transaction"),
  audited("IdentityAdminService.memberEdit", "auth/identity-admin-service.ts", "user", ["update"], "AccountProvisioningStore transaction"),
  audited("IdentityAdminService.roles", "auth/identity-admin-service.ts", "role", ["create", "update", "delete"], "AuthStore transaction"),
  audited("IdentityAdminService.credentialAdmin", "auth/identity-admin-service.ts", "user_auth", ["reset_password"], "AuthStore transaction"),
  audited("AuthService.registration", "auth/auth-service.ts", "user", ["register"], "AuthStore transaction"),
  audited("AuthService.accountCredentials", "auth/auth-service.ts", "user_auth", ["change_password", "update"], "AuthStore transaction"),
  audited("OAuthService.accountLinks", "auth/oauth-service.ts", "user_auth", ["update"], "OAuthStore transaction"),
  audited("EmailVerificationService.contacts", "auth/email-verification-service.ts", "user_auth", ["update"], "EmailVerificationStore transaction"),
  exempt("AuthService.loginRuntime", "auth/auth-service.ts", "Login attempts, failure counters, password rehashes, and sessions are runtime security state."),

  audited("AnnouncementService.mutations", "announcements/announcement-service.ts", "announcement", ["create", "update", "archive", "delete"], "AnnouncementStore transaction"),
  audited("ImportantNoticeService.mutations", "important-notices/important-notice-service.ts", "important_notice", ["create", "update", "publish", "withdraw", "delete"], "ImportantNoticeStore transaction"),
  audited("EventsService.events", "events/events-service.ts", "event", ["create", "update", "archive", "delete", "upload_images", "raffle_draw"], "EventsStore transaction"),
  audited("EventsService.participants", "events/events-service.ts", "event_participant", ["join", "leave", "batch_add_by_moderator", "batch_remove_by_moderator"], "EventsStore transaction"),
  audited("EventsService.pollVotes", "events/events-service.ts", "event_poll_vote", ["vote"], "EventsStore transaction"),
  audited("EventsService.recurringTemplates", "events/events-service.ts", "recurring_template", ["create", "update", "pause", "resume", "delete"], "EventsStore transaction"),
  audited("GalleryService.mutations", "gallery/gallery-service.ts", "gallery_item", ["upload_images", "create_video", "update", "delete", "batch_delete"], "GalleryStore transaction"),
  audited("NotificationInboxService.preferences", "notifications/inbox-service.ts", "user", ["update"], "NotificationInboxStore transaction"),

  audited("GuildWarService.activeRoster", "guild-war/guild-war-service.ts", "guild_war", ["init", "save_teams", "move_member", "set_role_tag"], "GuildWarStore transaction"),
  audited("GuildWarService.history", "guild-war/guild-war-service.ts", "guild_war_history", ["create", "update", "delete", "conclude"], "GuildWarStore transaction"),
  audited("GuildWarService.memberStats", "guild-war/guild-war-service.ts", "guild_war_member_stats", ["update", "batch_update"], "GuildWarStore transaction"),

  audited("MemberService.profile", "members/member-service.ts", "member_profile", ["update", "upload_images", "delete_images", "upload_avatar", "delete_avatar", "upload_audio", "delete_audio"], "MembersStore or MemberMediaStore transaction"),
  audited("MemberService.absences", "members/member-service.ts", "member_absence", ["create", "delete"], "MembersStore transaction"),
  audited("MemberCatalogService.classes", "members/member-catalog-service.ts", "class_catalog", ["create", "update", "reorder", "delete", "upload_icon"], "MembersStore or MemberMediaStore transaction"),
  audited("MemberCatalogService.classTags", "members/member-catalog-service.ts", "class_tag", ["create", "update", "reorder", "delete"], "MembersStore transaction"),
  audited("MemberCatalogService.badges", "members/member-catalog-service.ts", "member_badge", ["create", "update", "reorder", "delete", "assign", "unassign"], "MembersStore transaction"),

  audited("StorageService.structure", "storage/storage-service.ts", "storage", ["create", "update", "delete"], "StorageStore transaction"),
  audited("StorageService.categories", "storage/storage-service.ts", "storage_category", ["create", "update", "delete"], "StorageStore transaction"),
  audited("StorageService.items", "storage/storage-service.ts", "storage_item", ["create", "update", "delete", "upload_images", "delete_images"], "StorageStore transaction"),
  audited("StorageService.stock", "storage/storage-service.ts", "storage_transaction", ["intake", "distribute", "adjust"], "StorageStore transaction"),
  audited("WikiService.categories", "wiki/wiki-service.ts", "wiki_category", ["create", "update", "batch_update", "delete"], "WikiStore transaction"),
  audited("WikiService.articles", "wiki/wiki-service.ts", "wiki_article", ["create", "update", "archive", "delete", "rollback", "upload_images"], "WikiStore or MediaStore transaction"),
  audited("SiteConfigService.configuration", "site-config/site-config-service.ts", "site_config", ["update", "upload"], "SiteConfigStore transaction"),
  audited("SiteConfigService.analytics", "site-config/site-config-service.ts", "analytics_settings", ["update"], "SiteConfigStore transaction"),
  audited("SystemTestService.finalSummary", "system-test/system-test-service.ts", "system_test", ["run"], "SystemTestStore finalization transaction"),
  exempt("SystemTestService.internalRequestsAndCleanup", "system-test/system-test-service.ts", "Internal request registration, artifact cleanup, and expired-run cleanup are runtime test machinery."),

  audited("AuditService.exports", "audit/audit.ts", "audit_log_export", ["export_filtered_csv", "export_filtered_json"], "AuditStore transaction"),
  audited("ScheduledRecurrenceMaterializationJob", "jobs/scheduled-job-adapters.ts", "event", ["create"], "EventsStore transaction", "recurrence-materialization"),
  audited("ScheduledAnnouncementPublishJob", "jobs/scheduled-job-adapters.ts", "announcement", ["publish"], "Scheduled announcement transaction", "announcement-publish"),
  audited("ScheduledRaffleAutoDrawJob", "jobs/scheduled-job-adapters.ts", "event", ["raffle_draw"], "EventsStore transaction", "raffle-auto-draw"),
  audited("ScheduledEventAutoArchiveJob", "jobs/scheduled-job-adapters.ts", "event", ["archive"], "Scheduled event transaction", "event-auto-archive"),
  audited("ScheduledMediaGarbageCollectionJob", "jobs/scheduled-job-adapters.ts", "media_cleanup", ["delete"], "MediaStore final deletion transaction", "media-gc"),
  audited("ScheduledAuditArchiveJob", "jobs/scheduled-job-adapters.ts", "audit_archive_export", ["archive"], "AuditArchiveStore transaction", "audit-archive"),
  exempt("ScheduledSessionCleanupJob", "jobs/scheduled-jobs.ts", "Session expiry is runtime authentication state.", "session-cleanup"),
  exempt("ScheduledSystemTestCleanupJob", "jobs/scheduled-job-adapters.ts", "Expired system-test cleanup is internal test machinery.", "system-test-cleanup"),

  exempt("MediaService.internalLifecycle", "media/media-service.ts", "Uploading, staged, deleting, and claim transitions are internal media lifecycle state."),
  exempt("ScheduledJobCoordinator.leasesAndStatus", "jobs/scheduled-jobs.ts", "Leases, cursors, backlog inspection, and job status are runtime coordination state."),
  exempt("ErrorLogService.runtimeDiagnostics", "audit/error-log.ts", "Error reports are runtime diagnostics, not successful business mutations."),
  exempt("NotificationService.delivery", "notifications/notification-service.ts", "Notification delivery is runtime communication state."),
] as const satisfies readonly AuditCoverageEntry[];

function audited(
  operation: string,
  source: string,
  subjectType: AuditEntityType,
  actions: readonly AuditAction[],
  transactionOwner: string,
  scheduledJob?: ScheduledJobName,
): AuditedOperation {
  return {
    classification: "audited",
    operation,
    source,
    subjectType,
    actions,
    transactionOwner,
    ...(scheduledJob === undefined ? {} : { scheduledJob }),
  };
}

function exempt(
  operation: string,
  source: string,
  reason: string,
  scheduledJob?: ScheduledJobName,
): RuntimeExemption {
  return {
    classification: "runtime_exemption",
    operation,
    source,
    reason,
    ...(scheduledJob === undefined ? {} : { scheduledJob }),
  };
}
