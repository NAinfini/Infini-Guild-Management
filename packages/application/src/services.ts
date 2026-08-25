import type {
  BlobInventory,
  BlobStore,
  DeferredTasks,
  NotificationPublisher,
  RateLimiter,
  SqlExecutor,
} from "@guild/kernel";
import {
  appSchema,
  createAppDatabase,
  SqliteAbsencePolicyReader,
  SqliteAdminOperationsStore,
  SqliteAccountProvisioningStore,
  SqliteAnnouncementPublishStore,
  SqliteAnnouncementStore,
  SqliteAuditArchiveStore,
  SqliteAuditStore,
  SqliteBlobManifestStore,
  SqliteAuthStore,
  SqliteClassTagUsageReader,
  SqliteEventMediaPort,
  SqliteEventGuildWarLifecycleStore,
  SqliteEventAutoArchiveStore,
  SqliteEventsStore,
  SqliteErrorLogStore,
  SqliteEmailVerificationStore,
  SqliteGalleryStore,
  SqliteGuildWarStore,
  SqliteMediaStore,
  SqliteMemberMediaPort,
  SqliteMembersStore,
  SqliteNotificationInboxStore,
  SqliteImportantNoticeStore,
  SqlitePortalReadModelStore,
  SqliteRaffleAutoDrawStore,
  SqliteScheduledJobLeaseStore,
  SqliteSessionCleanupJob,
  SqliteSiteConfigStore,
  SqliteStorageMediaPort,
  SqliteStorageStore,
  SqliteSystemTestArtifactCleaner,
  SqliteSystemTestStore,
  SqliteWikiStore,
} from "@guild/persistence-sqlite";
import {
  AdminStatusService,
  AdminOperationsService,
  AnnouncementService,
  AuditArchiveService,
  AuditService,
  AuthService,
  BlobReconciliationService,
  EventsService,
  ErrorLogService,
  GalleryService,
  GuildWarService,
  IdentityAdminService,
  ImportantNoticeService,
  MediaService,
  MemberCatalogService,
  MemberService,
  NotificationService,
  NotificationInboxService,
  PortalReadModelService,
  ScheduledAuditArchiveJob,
  ScheduledAnnouncementPublishJob,
  ScheduledEventAutoArchiveJob,
  ScheduledJobCoordinator,
  ScheduledMediaGarbageCollectionJob,
  ScheduledRecurrenceMaterializationJob,
  ScheduledRaffleAutoDrawJob,
  ScheduledSystemTestCleanupJob,
  SiteConfigService,
  StorageService,
  SystemTestService,
  EmailVerificationService,
  WikiService,
  OAuthService,
  createInviteTokenCodec,
  type RuntimeHealthPort,
  type AdminOperationsRuntimePort,
} from "@guild/server";
import { SqliteOAuthStore } from "@guild/persistence-sqlite";
import { createOAuthProviderClients, oauthProviderAvailability, type OAuthRuntimeConfig } from "./oauth-providers.js";

export type ApplicationServicePorts = Readonly<{
  sql: SqlExecutor;
  blobs: BlobStore;
  blobInventory: BlobInventory;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  health: RuntimeHealthPort;
  adminOperationsRuntime: AdminOperationsRuntimePort;
  authRateLimiter: RateLimiter;
  authIpRateLimiter: RateLimiter;
  emailSender?: import("@guild/server").TransactionalEmailSender | null;
}>;

export type ApplicationServiceConfig = Readonly<{
  inviteTokenSecret: string;
  passwordIterations: number;
  publicUrl: string;
  oauth: OAuthRuntimeConfig;
  emailFrom: string | null;
}>;

export function createApplicationServices(
  ports: ApplicationServicePorts,
  config: ApplicationServiceConfig,
) {
  const db = createAppDatabase(ports.sql, { schema: appSchema });
  const notifications = new NotificationService(ports.notifications);
  const notificationInbox = new NotificationInboxService(
    new SqliteNotificationInboxStore(ports.sql),
    notifications,
    ports.deferred,
  );
  const importantNotices = new ImportantNoticeService(new SqliteImportantNoticeStore(ports.sql));

  const mediaStore = new SqliteMediaStore(ports.sql);
  const media = new MediaService(mediaStore, ports.blobs);
  const siteConfigStore = new SqliteSiteConfigStore(ports.sql);

  const memberMedia = new SqliteMemberMediaPort(ports.sql, media, async () => {
    const current = await siteConfigStore.get();
    return {
      maxProfileImageBytes: current.media_policy.max_file_size_bytes.profile_image,
      maxProfileAudioBytes: current.media_policy.max_file_size_bytes.profile_audio,
      maxClassIconBytes: current.media_policy.max_file_size_bytes.class_icon,
      maxProfileImages: current.media_policy.quotas.profile,
    };
  });
  const membersStore = new SqliteMembersStore(db, ports.sql);
  const members = new MemberService({
    store: membersStore,
    media: memberMedia,
    absencePolicy: new SqliteAbsencePolicyReader(ports.sql),
  });
  const memberCatalog = new MemberCatalogService({
    store: membersStore,
    media: memberMedia,
    tagUsage: new SqliteClassTagUsageReader(ports.sql),
  });

  const authStore = new SqliteAuthStore(db, ports.sql);
  const accountProvisioning = new SqliteAccountProvisioningStore(db, ports.sql);
  const inviteTokens = createInviteTokenCodec(config.inviteTokenSecret);
  const auth = new AuthService({
    store: authStore,
    provisioning: accountProvisioning,
    profiles: members,
    inviteTokens,
    loginIpRateLimiter: ports.authIpRateLimiter,
    loginNameRateLimiter: ports.authRateLimiter,
    passwordIterations: config.passwordIterations,
    notifications,
    deferred: ports.deferred,
  });
  const identityAdmin = new IdentityAdminService({
    store: authStore,
    provisioning: accountProvisioning,
    inviteTokens,
    passwordIterations: config.passwordIterations,
    notifications,
    deferred: ports.deferred,
  });

  const eventsStore = new SqliteEventsStore(db, ports.sql);
  const eventGuildWarLifecycle = new SqliteEventGuildWarLifecycleStore(ports.sql);
  const events = new EventsService({
    store: eventsStore,
    lifecycle: eventGuildWarLifecycle,
    media: new SqliteEventMediaPort(ports.sql),
    notifications,
    deferred: ports.deferred,
  });
  const guildWar = new GuildWarService({
    store: new SqliteGuildWarStore(db, ports.sql),
    eventRoster: eventGuildWarLifecycle,
    events,
    analyticsSettings: { read: async () => (await siteConfigStore.get()).analytics_settings },
    notifications,
    deferred: ports.deferred,
  });

  const storageMedia = new SqliteStorageMediaPort(ports.sql, media, async () => {
    const current = await siteConfigStore.get();
    return {
      maxImageBytes: current.media_policy.max_file_size_bytes.storage_image,
      maxImagesPerItem: current.storage_policy.images_per_item,
    };
  });
  const storage = new StorageService(
    new SqliteStorageStore(db, ports.sql),
    storageMedia,
    notifications,
    ports.deferred,
  );
  const systemTest = new SystemTestService(
    new SqliteSystemTestStore(ports.sql),
    new SqliteSystemTestArtifactCleaner(ports.sql),
    ports.blobs,
  );
  const announcements = new AnnouncementService(
    new SqliteAnnouncementStore(ports.sql), media, notifications, ports.deferred,
  );
  const gallery = new GalleryService(
    new SqliteGalleryStore(ports.sql), media, notifications, ports.deferred,
  );
  const wiki = new WikiService(
    new SqliteWikiStore(ports.sql), media, notifications, ports.deferred,
  );
  const oauthClients = createOAuthProviderClients(config.oauth);
  const siteConfig = new SiteConfigService(
    siteConfigStore,
    media,
    notifications,
    ports.deferred,
    oauthProviderAvailability(config.oauth),
  );
  const oauth = new OAuthService({
    store: new SqliteOAuthStore(ports.sql),
    authStore,
    siteConfig,
    clients: oauthClients,
    publicUrl: config.publicUrl,
  });
  const emailVerification = new EmailVerificationService({
    store: new SqliteEmailVerificationStore(ports.sql),
    authStore,
    sender: ports.emailSender ?? null,
    from: config.emailFrom,
    publicUrl: config.publicUrl,
  });
  const audit = new AuditService(new SqliteAuditStore(ports.sql));
  const errorLog = new ErrorLogService(new SqliteErrorLogStore(ports.sql));
  const auditArchive = new AuditArchiveService(new SqliteAuditArchiveStore(ports.sql), ports.blobs);
  const blobReconciliation = new BlobReconciliationService(
    new SqliteBlobManifestStore(ports.sql),
    ports.blobs,
    ports.blobInventory,
  );
  const adminOperationsStore = new SqliteAdminOperationsStore(ports.sql);
  const scheduledJobs = new ScheduledJobCoordinator({
    leases: new SqliteScheduledJobLeaseStore(ports.sql),
    statuses: adminOperationsStore,
    recurrenceMaterialization: new ScheduledRecurrenceMaterializationJob(eventsStore, notifications),
    announcementPublish: new ScheduledAnnouncementPublishJob(
      new SqliteAnnouncementPublishStore(ports.sql),
      notifications,
    ),
    raffleAutoDraw: new ScheduledRaffleAutoDrawJob(
      new SqliteRaffleAutoDrawStore(ports.sql, eventsStore),
      notifications,
    ),
    eventAutoArchive: new ScheduledEventAutoArchiveJob(
      new SqliteEventAutoArchiveStore(ports.sql),
      notifications,
    ),
    mediaGarbageCollection: new ScheduledMediaGarbageCollectionJob(media),
    auditArchive: new ScheduledAuditArchiveJob(auditArchive),
    sessionCleanup: new SqliteSessionCleanupJob(ports.sql),
    systemTestCleanup: new ScheduledSystemTestCleanupJob(systemTest),
  });
  const portalReadModels = new PortalReadModelService(new SqlitePortalReadModelStore(ports.sql));
  const adminStatus = new AdminStatusService(ports.health);
  const adminOperations = new AdminOperationsService(adminOperationsStore, ports.adminOperationsRuntime);
  const health = Object.freeze({
    check(): Promise<void> {
      return Promise.resolve();
    },
  });

  return Object.freeze({
    adminOperations,
    adminStatus,
    announcements,
    audit,
    auditArchive,
    blobReconciliation,
    auth,
    events,
    errorLog,
    emailVerification,
    gallery,
    guildWar,
    health,
    identityAdmin,
    importantNotices,
    media,
    memberCatalog,
    members,
    notificationInbox,
    oauth,
    portalReadModels,
    scheduledJobs,
    siteConfig,
    storage,
    systemTest,
    wiki,
  });
}

export type ApplicationServices = ReturnType<typeof createApplicationServices>;
