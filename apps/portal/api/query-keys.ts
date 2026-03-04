export const queryKeys = {
  auth: {
    all: ["auth"] as const,
    usernameAvailability: (username: string) => [...queryKeys.auth.all, "username-availability", username] as const,
  },
  users: {
    all: ["users"] as const,
    roster: (viewMode: "external" | "default") => [...queryKeys.users.all, "roster", viewMode] as const,
  },
  myProfile: {
    all: ["my-profile"] as const,
    detail: (userId: string | undefined) => [...queryKeys.myProfile.all, userId] as const,
  },
  event: {
    all: ["event"] as const,
    detail: (id: string) => [...queryKeys.event.all, id] as const,
  },
  events: {
    all: ["events"] as const,
    list: (eventType: string, archivedOnly: boolean) => [...queryKeys.events.all, eventType, archivedOnly] as const,
    memberPreviewUsers: () => [...queryKeys.events.all, "member-preview-users"] as const,
    previewDetails: () => [...queryKeys.events.all, "preview-details"] as const,
    previewDetailsByIds: (idsKey: string) => [...queryKeys.events.previewDetails(), idsKey] as const,
  },
  announcements: {
    all: ["announcements"] as const,
    list: (scope: string, status: string, search: string) => [...queryKeys.announcements.all, scope, status, search] as const,
    detail: (id: string | null) => [...queryKeys.announcements.all, "detail", id] as const,
  },
  gallery: {
    all: ["gallery"] as const,
    list: (sortOrder: string, typeFilter: string, dateFrom: string, dateTo: string, search: string) =>
      [...queryKeys.gallery.all, sortOrder, typeFilter, dateFrom, dateTo, search] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    upcomingEvents: (nowIso: string) => [...queryKeys.dashboard.all, "upcoming-events", nowIso] as const,
    wars: () => [...queryKeys.dashboard.all, "wars"] as const,
    users: () => [...queryKeys.dashboard.all, "users"] as const,
    lastWarDetail: (warId: string) => [...queryKeys.dashboard.all, "last-war-detail", warId] as const,
    upcomingEventDetails: (eventIdsKey: string) =>
      [...queryKeys.dashboard.all, "upcoming-event-details", eventIdsKey] as const,
    upcomingEventDetailsAll: () => [...queryKeys.dashboard.all, "upcoming-event-details"] as const,
    mySignups: (userId: string, eventIdsKey: string) =>
      [...queryKeys.dashboard.all, "my-signups", userId, eventIdsKey] as const,
    mySignupsAll: () => [...queryKeys.dashboard.all, "my-signups"] as const,
  },
  admin: {
    all: ["admin"] as const,
    users: () => [...queryKeys.admin.all, "users"] as const,
    inviteLinks: () => [...queryKeys.admin.all, "invite-links"] as const,
    inviteStats: () => [...queryKeys.admin.all, "invite-stats"] as const,
    auditLog: (page: number, search: string, startAt: string, endAt: string) =>
      [...queryKeys.admin.all, "audit-log", page, search, startAt, endAt] as const,
    auditMonths: () => [...queryKeys.admin.all, "audit-months"] as const,
    auditArchive: (month?: string | null, page?: number) => [...queryKeys.admin.all, "audit-archive", month ?? null, page ?? 1] as const,
    botSettings: () => [...queryKeys.admin.all, "bot-settings"] as const,
    discordChannels: (guildId: string) => [...queryKeys.admin.all, "discord-channels", guildId] as const,
    status: () => [...queryKeys.admin.all, "status"] as const,
  },
  guildWar: {
    all: ["guild-war"] as const,
    events: () => [...queryKeys.guildWar.all, "events"] as const,
    eventDetail: (eventId: string | null) => [...queryKeys.guildWar.all, "event-detail", eventId] as const,
    active: (eventIdKey: string) => [...queryKeys.guildWar.all, "active", eventIdKey] as const,
    templates: (eventIdKey: string) => [...queryKeys.guildWar.all, "templates", eventIdKey] as const,
    history: (fromKey: string, toKey: string) => [...queryKeys.guildWar.all, "history", fromKey, toKey] as const,
    historyAll: () => [...queryKeys.guildWar.all, "history"] as const,
    historyDetail: (historyId: string | null) => [...queryKeys.guildWar.all, "history-detail", historyId] as const,
    analytics: (warIdsKey: string) => [...queryKeys.guildWar.all, "analytics", warIdsKey] as const,
    analyticsDetails: (warIdsKey: string) => [...queryKeys.guildWar.all, "analytics-details", warIdsKey] as const,
    analyticsDetailsAll: () => [...queryKeys.guildWar.all, "analytics-details"] as const,
  },
  wiki: {
    all: ["wiki"] as const,
    categories: () => [...queryKeys.wiki.all, "categories"] as const,
    articles: (categoryId: string, search: string, archivedMode: string) =>
      [...queryKeys.wiki.all, "articles", categoryId, search, archivedMode] as const,
    article: (slug: string | null) => [...queryKeys.wiki.all, "article", slug] as const,
    articleVersions: (articleId: string) => [...queryKeys.wiki.all, "article-versions", articleId] as const,
    articleVersionsCompare: (articleId: string, fromVersionId: string, toVersionId: string) =>
      [...queryKeys.wiki.all, "article-versions-compare", articleId, fromVersionId, toVersionId] as const,
  },
} as const;
