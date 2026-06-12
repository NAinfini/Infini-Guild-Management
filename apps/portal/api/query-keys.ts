export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    usernameAvailability: (username: string) => [...queryKeys.auth.all, "username-availability", username] as const,
    verifyInvite: (code: string) => [...queryKeys.auth.all, "verify-invite", code] as const,
  },
  users: {
    all: ["users"] as const,
    roster: (viewMode: "external" | "default") => [...queryKeys.users.all, "roster", viewMode] as const,
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
    list: (scope: string, status: string, search: string, page?: number) => [...queryKeys.announcements.all, scope, status, search, page ?? 1] as const,
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
    items: (storageId: string, categoryId: string | null, search: string) => [...queryKeys.storage.all, "items", storageId, categoryId, search] as const,
    item: (id: string | null) => [...queryKeys.storage.all, "item", id] as const,
    transactions: (filter: string, page: number) => [...queryKeys.storage.all, "transactions", filter, page] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: () => [...queryKeys.dashboard.all, "summary"] as const,
    upcomingEvents: (nowIso: string) => [...queryKeys.dashboard.all, "upcoming-events", nowIso] as const,
    wars: () => [...queryKeys.dashboard.all, "wars"] as const,
    lastWarDetail: (warId: string) => [...queryKeys.dashboard.all, "last-war-detail", warId] as const,
    upcomingEventDetails: (eventIdsKey: string) =>
      [...queryKeys.dashboard.all, "upcoming-event-details", eventIdsKey] as const,
    upcomingEventDetailsAll: () => [...queryKeys.dashboard.all, "upcoming-event-details"] as const,
  },
  admin: {
    all: ["admin"] as const,
    inviteLinks: () => [...queryKeys.admin.all, "invite-links"] as const,
    inviteStats: () => [...queryKeys.admin.all, "invite-stats"] as const,
    auditLog: (page: number, search: string, startAt: string, endAt: string, entityType?: string, actorId?: string) =>
      [...queryKeys.admin.all, "audit-log", page, search, startAt, endAt, entityType ?? null, actorId ?? null] as const,
    auditMonths: () => [...queryKeys.admin.all, "audit-months"] as const,
    auditArchive: (month?: string | null, page?: number) => [...queryKeys.admin.all, "audit-archive", month ?? null, page ?? 1] as const,
    roles: () => [...queryKeys.admin.all, "roles"] as const,
    status: () => [...queryKeys.admin.all, "status"] as const,
  },
  guildWar: {
    all: ["guild-war"] as const,
    events: () => [...queryKeys.guildWar.all, "events"] as const,
    eventDetail: (eventId: string | null) => [...queryKeys.guildWar.all, "event-detail", eventId] as const,
    active: (eventIdKey: string | null) => [...queryKeys.guildWar.all, "active", eventIdKey] as const,
    history: (fromKey: string, toKey: string, page?: number, perPage?: number) => [...queryKeys.guildWar.all, "history", fromKey, toKey, page ?? 1, perPage ?? 20] as const,
    historyAll: () => [...queryKeys.guildWar.all, "history"] as const,
    historyDetail: (historyId: string | null) => [...queryKeys.guildWar.all, "history-detail", historyId] as const,
    analytics: (warIdsKey: string) => [...queryKeys.guildWar.all, "analytics", warIdsKey] as const,
    analyticsDetails: (warIdsKey: string) => [...queryKeys.guildWar.all, "analytics-details", warIdsKey] as const,
    analyticsDetailsAll: () => [...queryKeys.guildWar.all, "analytics-details"] as const,
    concludedEventIds: () => [...queryKeys.guildWar.all, "concluded-event-ids"] as const,
  },
  wiki: {
    all: ["wiki"] as const,
    categories: () => [...queryKeys.wiki.all, "categories"] as const,
    articles: (categoryId: string, search: string, archivedMode: string, pinnedOnly: boolean, page?: number) =>
      [...queryKeys.wiki.all, "articles", categoryId, search, archivedMode, pinnedOnly, page ?? 1] as const,
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
  gameData: {
    all: ["game-data"] as const,
    latest: () => [...queryKeys.gameData.all, "latest"] as const,
    versions: () => [...queryKeys.gameData.all, "versions"] as const,
  },
  cmdk: {
    all: ["cmdk"] as const,
    search: (query: string) => [...queryKeys.cmdk.all, "search", query] as const,
  },
} as const;
