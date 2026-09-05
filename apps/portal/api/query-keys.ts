export const queryKeys = {
  notifications: {
    all: ["notifications"] as const,
    user: (userId: string) => ["notifications", "inbox", userId] as const,
    inbox: (userId: string | null | undefined) =>
      [...queryKeys.notifications.user(userId ?? "anonymous"), "recent"] as const,
    unreadCount: (userId: string | null | undefined) =>
      [...queryKeys.notifications.user(userId ?? "anonymous"), "unread-count"] as const,
    preferences: (userId: string | null | undefined) =>
      [...queryKeys.notifications.user(userId ?? "anonymous"), "preferences"] as const,
  },
  importantNotices: {
    all: ["important-notices"] as const,
    active: (userId: string | null | undefined) => ["important-notices", "active", userId ?? "anonymous"] as const,
    admin: () => ["important-notices", "admin"] as const,
    audienceRoles: () => ["important-notices", "admin", "audience-roles"] as const,
  },
  auth: {
    all: ["auth"] as const,
    security: () => [...queryKeys.auth.all, "security"] as const,
    verifyInvite: (code: string) => [...queryKeys.auth.all, "verify-invite", code] as const,
  },
  users: {
    all: ["users"] as const,
    list: (viewerKey: string, projection: "public" | "internal", filters: object) =>
      [...queryKeys.users.all, "list", viewerKey, projection, filters] as const,
    detail: (viewerKey: string, projection: "public" | "internal", userId: string | null) =>
      [...queryKeys.users.all, "detail", viewerKey, projection, userId] as const,
    directory: (viewerKey: string, projection: "public" | "internal", search = "") =>
      [...queryKeys.users.all, "directory", viewerKey, projection, search] as const,
    identities: (viewerKey: string, projection: "public" | "internal", idsKey: string) =>
      [...queryKeys.users.all, "identities", viewerKey, projection, idsKey] as const,
    planning: (viewerKey: string, projection: "public" | "internal", idsKey: string) =>
      [...queryKeys.users.all, "planning", viewerKey, projection, idsKey] as const,
    availabilitySummary: (viewerKey: string) => [...queryKeys.users.all, "availability-summary", viewerKey] as const,
    stats: () => [...queryKeys.users.all, "stats"] as const,
  },
  absences: {
    all: ["absences"] as const,
    window: (from: string, to: string) => [...queryKeys.absences.all, "window", from, to] as const,
    user: (userId: string | undefined) => [...queryKeys.absences.all, "user", userId] as const,
  },
  myProfile: {
    all: ["my-profile"] as const,
    detail: (userId: string | undefined) => [...queryKeys.myProfile.all, userId] as const,
  },
  events: {
    all: ["events"] as const,
    list: (filters: {
      eventType: string;
      status: string;
      search: string;
      pinnedOnly: boolean;
      lockedOnly: boolean;
      page?: number;
    }) =>
      [
        ...queryKeys.events.all,
        filters.eventType,
        filters.status,
        filters.search,
        filters.pinnedOnly,
        filters.lockedOnly,
        filters.page ?? 1,
      ] as const,
    detail: (id: string) => [...queryKeys.events.all, "detail", id] as const,
    previewDetails: () => [...queryKeys.events.all, "preview-details"] as const,
    previewDetailsByIds: (idsKey: string) => [...queryKeys.events.previewDetails(), idsKey] as const,
    templates: () => [...queryKeys.events.all, "templates"] as const,
  },
  announcements: {
    all: ["announcements"] as const,
    list: (status: string, category: string, search: string, sort: string) =>
      [...queryKeys.announcements.all, "list", status, category, search, sort] as const,
    pinned: () => [...queryKeys.announcements.all, "pinned"] as const,
    detail: (id: string | null) => [...queryKeys.announcements.all, "detail", id] as const,
  },
  gallery: {
    all: ["gallery"] as const,
    list: (sortOrder: string, typeFilter: string, dateFrom: string, dateTo: string, search: string) =>
      [...queryKeys.gallery.all, sortOrder, typeFilter, dateFrom, dateTo, search] as const,
  },
  storage: {
    all: ["storage"] as const,
    tree: () => [...queryKeys.storage.all, "tree"] as const,
    itemsRoot: () => [...queryKeys.storage.all, "items"] as const,
    items: (
      storageId: string,
      categoryId: string | null,
      search: string,
      stock: string,
      limit: number,
    ) => [
      ...queryKeys.storage.itemsRoot(),
      storageId,
      categoryId,
      search,
      stock,
      limit,
    ] as const,
    item: (id: string | null) => [...queryKeys.storage.all, "item", id] as const,
    transactions: (filter: string, page: number, limit: number) =>
      [...queryKeys.storage.all, "transactions", filter, page, limit] as const,
  },
  siteConfig: {
    all: ["site-config"] as const,
    admin: () => [...queryKeys.siteConfig.all, "admin"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    latestAnnouncement: () => [...queryKeys.dashboard.all, "latest-announcement"] as const,
    members: () => [...queryKeys.dashboard.all, "members"] as const,
    events: (viewerKey: string, externalView: boolean) =>
      [...queryKeys.dashboard.all, "events", viewerKey, externalView] as const,
    wars: (viewerKey: string, externalView: boolean) =>
      [...queryKeys.dashboard.all, "wars", viewerKey, externalView] as const,
    lastWarDetail: (warId: string) => [...queryKeys.dashboard.all, "last-war-detail", warId] as const,
    upcomingEventDetails: (eventIdsKey: string) =>
      [...queryKeys.dashboard.all, "upcoming-event-details", eventIdsKey] as const,
    upcomingEventDetailsAll: () => [...queryKeys.dashboard.all, "upcoming-event-details"] as const,
  },
  admin: {
    all: ["admin"] as const,
    inviteLinksAll: () => [...queryKeys.admin.all, "invite-links"] as const,
    inviteLinks: (visibility: string, search: string) =>
      [...queryKeys.admin.inviteLinksAll(), visibility, search] as const,
    inviteStats: () => [...queryKeys.admin.all, "invite-stats"] as const,
    auditLog: (search: string, startAt: string, endAt: string, entityType?: string, entityId?: string, actorId?: string) =>
      [...queryKeys.admin.all, "audit-log", search, startAt, endAt, entityType ?? null, entityId ?? null, actorId ?? null] as const,
    auditMonths: () => [...queryKeys.admin.all, "audit-months"] as const,
    operations: () => [...queryKeys.admin.all, "operations"] as const,
    auditArchive: (month?: string | null, page?: number) => [...queryKeys.admin.all, "audit-archive", month ?? null, page ?? 1] as const,
    roles: () => [...queryKeys.admin.all, "roles"] as const,
    status: () => [...queryKeys.admin.all, "status"] as const,
  },
  guildWar: {
    all: ["guild-war"] as const,
    events: () => [...queryKeys.guildWar.all, "events"] as const,
    eventDetail: (eventId: string | null) => [...queryKeys.guildWar.all, "event-detail", eventId] as const,
    active: (eventIdKey: string | null) => [...queryKeys.guildWar.all, "active", eventIdKey] as const,
    history: (fromKey: string, toKey: string, searchKey: string, page?: number, perPage?: number) =>
      [...queryKeys.guildWar.all, "history", fromKey, toKey, searchKey, page ?? 1, perPage ?? 20] as const,
    historyAll: () => [...queryKeys.guildWar.all, "history"] as const,
    historyDetail: (historyId: string | null) => [...queryKeys.guildWar.all, "history-detail", historyId] as const,
    analyticsAll: () => [...queryKeys.guildWar.all, "analytics"] as const,
    analytics: (warIdsKey: string) => [...queryKeys.guildWar.analyticsAll(), warIdsKey] as const,
    analyticsDetails: (warIdsKey: string) => [...queryKeys.guildWar.all, "analytics-details", warIdsKey] as const,
    analyticsDetailsAll: () => [...queryKeys.guildWar.all, "analytics-details"] as const,
    concludedEventIds: () => [...queryKeys.guildWar.all, "concluded-event-ids"] as const,
  },
  wiki: {
    all: ["wiki"] as const,
    categories: () => [...queryKeys.wiki.all, "categories"] as const,
    pinned: () => [...queryKeys.wiki.all, "pinned"] as const,
    articles: (categoryId: string, search: string, archivedMode: string, sort: string) =>
      [...queryKeys.wiki.all, "articles", categoryId, search, archivedMode, sort] as const,
    article: (slug: string | null) => [...queryKeys.wiki.all, "article", slug] as const,
    revisions: (articleId: string | null) => [...queryKeys.wiki.all, "revisions", articleId] as const,
    revision: (articleId: string | null, revision: number | null) => [...queryKeys.wiki.all, "revision", articleId, revision] as const,
  },
  badges: {
    all: ["badges"] as const,
    list: () => [...queryKeys.badges.all, "list"] as const,
    detail: (id: string) => [...queryKeys.badges.all, "detail", id] as const,
    assignments: (id: string) => [...queryKeys.badges.all, "assignments", id] as const,
  },
  classes: {
    all: ["classes"] as const,
    list: () => [...queryKeys.classes.all, "list"] as const,
  },
  /* 标签自成一族。改标签成员不动职业目录，所以它不挂在 classes 下面；反过来删职业会
     把它从所有标签里带走，那一处要显式把这一族也作废掉。 */
  classTags: {
    all: ["class-tags"] as const,
    list: () => [...queryKeys.classTags.all, "list"] as const,
  },
  cmdk: {
    all: ["cmdk"] as const,
    search: (query: string) => [...queryKeys.cmdk.all, "search", query] as const,
  },
} as const;
