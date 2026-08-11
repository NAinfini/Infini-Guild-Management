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
  SqliteGalleryStore,
  SqliteGuildWarStore,
  SqliteMediaStore,
  SqliteMemberMediaPort,
  SqliteMembersStore,
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
  MediaService,
  MemberCatalogService,
  MemberService,
  NotificationService,
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
  WikiService,
  createInviteTokenCodec,
  type RuntimeHealthPort,
} from "@guild/server";

export type ApplicationServicePorts = Readonly<{
  sql: SqlExecutor;
  blobs: BlobStore;
  blobInventory: BlobInventory;
  notifications: NotificationPublisher;
  deferred: DeferredTasks;
  health: RuntimeHealthPort;
  authRateLimiter: RateLimiter;
}>;

export type ApplicationServiceConfig = Readonly<{
  inviteTokenSecret: string;
  passwordIterations: number;
}>;

export function createApplicationServices(
  ports: ApplicationServicePorts,
  config: ApplicationServiceConfig,
) {
  const db = createAppDatabase(ports.sql, { schema: appSchema });
  const notifications = new NotificationService(ports.notifications);

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
    loginRateLimiter: ports.authRateLimiter,
    passwordIterations: config.passwordIterations,
  });
  const identityAdmin = new IdentityAdminService({
    store: authStore,
    provisioning: accountProvisioning,
    inviteTokens,
    passwordIterations: config.passwordIterations,
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
  const siteConfig = new SiteConfigService(siteConfigStore, media, notifications, ports.deferred);
  const audit = new AuditService(new SqliteAuditStore(ports.sql));
  const errorLog = new ErrorLogService(new SqliteErrorLogStore(ports.sql));
  const auditArchive = new AuditArchiveService(new SqliteAuditArchiveStore(ports.sql), ports.blobs);
  const blobReconciliation = new BlobReconciliationService(
    new SqliteBlobManifestStore(ports.sql),
    ports.blobs,
    ports.blobInventory,
  );
  const scheduledJobs = new ScheduledJobCoordinator({
    leases: new SqliteScheduledJobLeaseStore(ports.sql),
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
  const health = Object.freeze({
    async check(): Promise<void> {
      const result = await ports.sql.execute({ method: "get", sql: "SELECT 1 AS ok" });
      if (!Array.isArray(result.rows) || result.rows[0] !== 1) {
        throw new TypeError("Database health probe failed");
      }
    },
  });

  return Object.freeze({
    adminStatus,
    announcements,
    audit,
    auditArchive,
    blobReconciliation,
    auth,
    events,
    errorLog,
    gallery,
    guildWar,
    health,
    identityAdmin,
    media,
    memberCatalog,
    members,
    portalReadModels,
    scheduledJobs,
    siteConfig,
    storage,
    systemTest,
    wiki,
  });
}

export type ApplicationServices = ReturnType<typeof createApplicationServices>;
