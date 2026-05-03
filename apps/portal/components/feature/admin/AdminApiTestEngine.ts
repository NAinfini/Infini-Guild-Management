// ─── API Test Infrastructure ─────────────────────────────────────────

export type EndpointDef = {
  /** Display label */
  label: string;
  /** HTTP method */
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** URL path (may include query params) */
  path: string;
};

export type CategoryDef = {
  key: string;
  label: string;
  endpoints: EndpointDef[];
};

export type TestRunContext = {
  meId: string | null;
  meUsername: string | null;
  registerInviteCode: string | null;
  targetUserId: string | null;
  userImageKey: string | null;
  userAudioKey: string | null;
  eventId: string | null;
  createdEventId: string | null;
  eventParticipantUserId: string | null;
  eventTemplateId: string | null;
  announcementId: string | null;
  galleryItemId: string | null;
  galleryDeleteId: string | null;
  galleryCommentId: string | null;
  warEventId: string | null;
  warHistoryId: string | null;
  warTeamId: string | null;
  warMemberUserId: string | null;
  wikiCategoryId: string | null;
  wikiArticleId: string | null;
  wikiArticleSlug: string | null;
  wikiArticleCategoryId: string | null;
  inviteLinkId: string | null;
  adminCreatedUserId: string | null;
  adminCreatedUserPassword: string | null;
  adminRoleId: string | null;
  auditArchiveMonth: string | null;
  auditArchiveDownloadToken: string | null;
  /** IDs of objects created by tests that need cleanup */
  registeredUserId: string | null;
  createdInviteLinkId: string | null;
  createdAnnouncementId: string | null;
  createdGalleryImageId: string | null;
  createdWikiCategoryId: string | null;
  createdWikiArticleId: string | null;
  createdWarHistoryId: string | null;
  createdRoleId: string | null;
  /** Snapshot of target user's profile before modification, for cleanup restore */
  targetProfileSnapshot: { bio: string | null; classes: string[] } | null;
};

export type PreparedEndpointRequest = {
  path: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  credentials?: RequestCredentials;
  skipReason?: string;
};

export type EndpointResult = {
  status: number | null;
  latencyMs: number;
  body: string;
  error: string | null;
  ranAt: string;
  parsedJson: unknown | null;
};

export type DebugLogEntry = {
  id: string;
  category: string;
  label: string;
  method: string;
  path: string;
  status: number | null;
  latencyMs: number;
  error: string | null;
  body: string;
  ranAt: string;
};

export const API_TEST_GAP_GET_MS = 90;
export const API_TEST_GAP_MUTATION_MS = 900;

export function createInitialTestRunContext(): TestRunContext {
  return {
    meId: null,
    meUsername: null,
    registerInviteCode: null,
    targetUserId: null,
    userImageKey: null,
    userAudioKey: null,
    eventId: null,
    createdEventId: null,
    eventParticipantUserId: null,
    eventTemplateId: null,
    announcementId: null,
    galleryItemId: null,
    galleryDeleteId: null,
    galleryCommentId: null,
    warEventId: null,
    warHistoryId: null,
    warTeamId: null,
    warMemberUserId: null,
    wikiCategoryId: null,
    wikiArticleId: null,
    wikiArticleSlug: null,
    wikiArticleCategoryId: null,
    inviteLinkId: null,
    adminCreatedUserId: null,
    adminCreatedUserPassword: null,
    adminRoleId: null,
    auditArchiveMonth: null,
    auditArchiveDownloadToken: null,
    registeredUserId: null,
    createdInviteLinkId: null,
    createdAnnouncementId: null,
    createdGalleryImageId: null,
    createdWikiCategoryId: null,
    createdWikiArticleId: null,
    createdWarHistoryId: null,
    createdRoleId: null,
    targetProfileSnapshot: null,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstArrayItem(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const first = value[0];
  return isRecord(first) ? first : null;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export function createTinyPngFile(): File {
  // Minimal valid 1x1 red PNG (68 bytes)
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x36, 0x28, 0xcf,
    0x80, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND chunk
  ]);
  return new File([bytes], "systemtest-image.png", { type: "image/png" });
}

export function createTinyAudioFile(): File {
  const payload = new Uint8Array([82, 73, 70, 70, 24, 0, 0, 0, 87, 65, 86, 69]);
  return new File([payload], "systemtest-audio.wav", { type: "audio/wav" });
}

export function buildJsonRequest(path: string, body: unknown): PreparedEndpointRequest {
  return {
    path,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

export function buildFormRequest(path: string, fields: Array<[string, string | File]>): PreparedEndpointRequest {
  const form = new FormData();
  for (const [key, value] of fields) {
    form.append(key, value);
  }
  return { path, body: form };
}

export function skipEndpoint(path: string, reason: string): PreparedEndpointRequest {
  return { path, skipReason: reason };
}

export function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort);
  });
}

export function readRetryAfterSeconds(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }
  const details = isRecord(payload.details) ? payload.details : null;
  const retryAfter = details?.retry_after_seconds;
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter < 0) {
    return null;
  }
  return Math.ceil(retryAfter);
}

export function replacePathParam(path: string, key: string, value: string | null): string | null {
  if (!path.includes(key)) {
    return path;
  }
  if (!value) {
    return null;
  }
  return path.replace(key, encodeURIComponent(value));
}

export function buildApiCategories(t: (key: string) => string): CategoryDef[] {
  return [
    {
      key: "system",
      label: t("status.api.cat.system"),
      endpoints: [
        { label: t("status.api.ep.healthCheck"), method: "GET", path: "/api/health" },
        { label: t("status.api.ep.adminStatus"), method: "GET", path: "/api/admin/status" },
        { label: t("status.api.ep.analyticsSettings"), method: "GET", path: "/api/admin/analytics-settings" },
        { label: t("status.api.ep.updateAnalyticsSettings"), method: "PATCH", path: "/api/admin/analytics-settings" },
      ],
    },
    {
      key: "auth",
      label: t("status.api.cat.auth"),
      endpoints: [
        { label: t("status.api.ep.checkUsername"), method: "GET", path: "/api/auth/check-username?username=test" },
        { label: t("status.api.ep.currentUser"), method: "GET", path: "/api/auth/me" },
        { label: t("status.api.ep.registerInvitePrep"), method: "GET", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.register"), method: "POST", path: "/api/auth/register/:inviteCode" },
      ],
    },
    {
      key: "users",
      label: t("status.api.cat.users"),
      endpoints: [
        { label: t("status.api.ep.listUsers"), method: "GET", path: "/api/users?page=1&limit=5" },
        { label: t("status.api.ep.getUserById"), method: "GET", path: "/api/users/:id" },
        { label: t("status.api.ep.updateProfile"), method: "PATCH", path: "/api/users/:id/profile" },
        { label: t("status.api.ep.uploadImage"), method: "POST", path: "/api/users/:id/media/images" },
        { label: t("status.api.ep.deleteImage"), method: "DELETE", path: "/api/users/:id/media/images/:key" },
        { label: t("status.api.ep.uploadAudio"), method: "POST", path: "/api/users/:id/media/audio" },
        { label: t("status.api.ep.deleteAudio"), method: "DELETE", path: "/api/users/:id/media/audio" },
        { label: t("status.api.ep.changePassword"), method: "POST", path: "/api/users/:id/change-password" },
        { label: t("status.api.ep.changeUsername"), method: "POST", path: "/api/users/:id/change-username" },
      ],
    },
    {
      key: "events",
      label: t("status.api.cat.events"),
      endpoints: [
        { label: t("status.api.ep.listEvents"), method: "GET", path: "/api/events?page=1&limit=5" },
        { label: t("status.api.ep.createEvent"), method: "POST", path: "/api/events" },
        { label: t("status.api.ep.getEvent"), method: "GET", path: "/api/events/:id" },
        { label: t("status.api.ep.updateEvent"), method: "PATCH", path: "/api/events/:id" },
        { label: t("status.api.ep.uploadEventImages"), method: "POST", path: "/api/events/:id/images" },
        { label: t("status.api.ep.joinEvent"), method: "POST", path: "/api/events/:id/join" },
        { label: t("status.api.ep.addParticipant"), method: "POST", path: "/api/events/:id/participants" },
        { label: t("status.api.ep.removeParticipant"), method: "DELETE", path: "/api/events/:id/participants/:userId" },
        { label: t("status.api.ep.leaveEvent"), method: "DELETE", path: "/api/events/:id/leave" },
        { label: t("status.api.ep.listTemplates"), method: "GET", path: "/api/events/templates/list" },
        { label: t("status.api.ep.createTemplate"), method: "POST", path: "/api/events/templates" },
        { label: t("status.api.ep.updateTemplate"), method: "PATCH", path: "/api/events/templates/:id" },
        { label: t("status.api.ep.pauseTemplate"), method: "POST", path: "/api/events/templates/:id/pause" },
        { label: t("status.api.ep.resumeTemplate"), method: "POST", path: "/api/events/templates/:id/resume" },
        { label: t("status.api.ep.deleteTemplate"), method: "DELETE", path: "/api/events/templates/:id" },
        { label: t("status.api.ep.archiveEvent"), method: "DELETE", path: "/api/events/:id" },
        { label: t("status.api.ep.destroyEvent"), method: "DELETE", path: "/api/events/:id/destroy" },
      ],
    },
    {
      key: "announcements",
      label: t("status.api.cat.announcements"),
      endpoints: [
        { label: t("status.api.ep.listAnnouncements"), method: "GET", path: "/api/announcements?page=1&limit=5" },
        { label: t("status.api.ep.createAnnouncement"), method: "POST", path: "/api/announcements" },
        { label: t("status.api.ep.getAnnouncement"), method: "GET", path: "/api/announcements/:id" },
        { label: t("status.api.ep.updateAnnouncement"), method: "PATCH", path: "/api/announcements/:id" },
        { label: t("status.api.ep.uploadAnnouncementImages"), method: "POST", path: "/api/announcements/:id/images" },
        { label: t("status.api.ep.archiveAnnouncement"), method: "DELETE", path: "/api/announcements/:id" },
      ],
    },
    {
      key: "gallery",
      label: t("status.api.cat.gallery"),
      endpoints: [
        { label: t("status.api.ep.listGallery"), method: "GET", path: "/api/gallery?limit=5" },
        { label: t("status.api.ep.uploadGalleryImages"), method: "POST", path: "/api/gallery/images" },
        { label: t("status.api.ep.addVideo"), method: "POST", path: "/api/gallery/videos" },
        { label: t("status.api.ep.likeItem"), method: "POST", path: "/api/gallery/:id/like" },
        { label: t("status.api.ep.listComments"), method: "GET", path: "/api/gallery/:id/comments" },
        { label: t("status.api.ep.addComment"), method: "POST", path: "/api/gallery/:id/comments" },
        { label: t("status.api.ep.editComment"), method: "PATCH", path: "/api/gallery/:id/comments/:commentId" },
        { label: t("status.api.ep.deleteComment"), method: "DELETE", path: "/api/gallery/:id/comments/:commentId" },
        { label: t("status.api.ep.deleteGalleryItem"), method: "DELETE", path: "/api/gallery/:id" },
      ],
    },
    {
      key: "guildWar",
      label: t("status.api.cat.guildWar"),
      endpoints: [
        { label: t("status.api.ep.activeWar"), method: "GET", path: "/api/guild-war/active" },
        { label: t("status.api.ep.saveTeams"), method: "POST", path: "/api/guild-war/save-teams" },
        { label: t("status.api.ep.moveMember"), method: "POST", path: "/api/guild-war/move" },
        { label: t("status.api.ep.updateRoleTag"), method: "PATCH", path: "/api/guild-war/role-tag" },
        { label: t("status.api.ep.exportGuildWar"), method: "GET", path: "/api/guild-war/export?format=json" },
        { label: t("status.api.ep.warHistory"), method: "GET", path: "/api/guild-war/history?page=1&limit=5" },
        { label: t("status.api.ep.historyDetail"), method: "GET", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.createHistory"), method: "POST", path: "/api/guild-war/history" },
        { label: t("status.api.ep.updateHistory"), method: "PATCH", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.updateMemberStats"), method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
        { label: t("status.api.ep.analytics"), method: "GET", path: "/api/guild-war/analytics" },
        { label: t("status.api.ep.deleteHistory"), method: "DELETE", path: "/api/guild-war/history/:id" },
      ],
    },
    {
      key: "wiki",
      label: t("status.api.cat.wiki"),
      endpoints: [
        { label: t("status.api.ep.listCategories"), method: "GET", path: "/api/wiki/categories" },
        { label: t("status.api.ep.createCategory"), method: "POST", path: "/api/wiki/categories" },
        { label: t("status.api.ep.updateCategory"), method: "PATCH", path: "/api/wiki/categories/:id" },
        { label: t("status.api.ep.listArticles"), method: "GET", path: "/api/wiki/articles?page=1&limit=5" },
        { label: t("status.api.ep.createArticle"), method: "POST", path: "/api/wiki/articles" },
        { label: t("status.api.ep.getArticle"), method: "GET", path: "/api/wiki/articles/:slug" },
        { label: t("status.api.ep.updateArticle"), method: "PATCH", path: "/api/wiki/articles/:id" },
        { label: t("status.api.ep.uploadArticleImages"), method: "POST", path: "/api/wiki/articles/:id/images" },
        { label: t("status.api.ep.archiveArticle"), method: "DELETE", path: "/api/wiki/articles/:id" },
        { label: t("status.api.ep.deleteCategory"), method: "DELETE", path: "/api/wiki/categories/:id" },
      ],
    },
    {
      key: "adminInvites",
      label: t("status.api.cat.adminInvites"),
      endpoints: [
        { label: t("status.api.ep.listInviteLinks"), method: "GET", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.inviteStats"), method: "GET", path: "/api/admin/invite-links/stats" },
        { label: t("status.api.ep.createInvite"), method: "POST", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.revokeInvite"), method: "DELETE", path: "/api/admin/invite-links/:id" },
      ],
    },
    {
      key: "adminAudit",
      label: t("status.api.cat.adminAudit"),
      endpoints: [
        { label: t("status.api.ep.auditLog"), method: "GET", path: "/api/admin/audit-log?page=1&limit=5" },
        { label: t("status.api.ep.auditLogExport"), method: "GET", path: "/api/admin/audit-log/export?format=json" },
        { label: t("status.api.ep.archiveMonths"), method: "GET", path: "/api/admin/audit-archive/months" },
        { label: t("status.api.ep.archiveDownload"), method: "GET", path: "/api/admin/audit-archive/download" },
        { label: t("status.api.ep.archiveDownloadFile"), method: "GET", path: "/api/admin/audit-archive/download/file" },
        { label: t("status.api.ep.archiveByMonth"), method: "GET", path: "/api/admin/audit-archive/:month" },
      ],
    },
    {
      key: "adminUsers",
      label: t("status.api.cat.adminUsers"),
      endpoints: [
        { label: t("status.api.ep.createMember"), method: "POST", path: "/api/admin/users" },
        { label: t("status.api.ep.changeUserRole"), method: "PATCH", path: "/api/admin/users/:id/role" },
        { label: t("status.api.ep.deactivateUser"), method: "PATCH", path: "/api/admin/users/:id/deactivate" },
        { label: t("status.api.ep.reactivateUser"), method: "PATCH", path: "/api/admin/users/:id/reactivate" },
        { label: t("status.api.ep.resetPassword"), method: "POST", path: "/api/admin/users/:id/reset-password" },
        { label: t("status.api.ep.batchRoleChange"), method: "PATCH", path: "/api/admin/users/batch/role" },
        { label: t("status.api.ep.batchDeactivate"), method: "PATCH", path: "/api/admin/users/batch/deactivate" },
        { label: t("status.api.ep.batchReactivate"), method: "PATCH", path: "/api/admin/users/batch/reactivate" },
        { label: t("status.api.ep.batchDelete"), method: "PATCH", path: "/api/admin/users/batch/delete" },
      ],
    },
    {
      key: "adminRoles",
      label: t("status.api.cat.adminRoles"),
      endpoints: [
        { label: t("status.api.ep.listRoles"), method: "GET", path: "/api/admin/roles" },
        { label: t("status.api.ep.createRole"), method: "POST", path: "/api/admin/roles" },
        { label: t("status.api.ep.updateRole"), method: "PATCH", path: "/api/admin/roles/:id" },
        { label: t("status.api.ep.deleteRole"), method: "DELETE", path: "/api/admin/roles/:id" },
      ],
    },
  ];
}

export function resolveEndpointPath(endpoint: EndpointDef, context: TestRunContext): { path: string; missing: string | null } {
  let path = endpoint.path;

  if (endpoint.path === "/api/admin/audit-archive/download") {
    const month = context.auditArchiveMonth;
    if (!month) {
      return { path, missing: "archive month (run archive months first)" };
    }
    return {
      path: `/api/admin/audit-archive/download?month=${encodeURIComponent(month)}&format=raw_ndjson_gz`,
      missing: null,
    };
  }

  if (endpoint.path === "/api/admin/audit-archive/download/file") {
    if (!context.auditArchiveDownloadToken) {
      return { path, missing: "download token (run archive download first)" };
    }
    return {
      path: `/api/admin/audit-archive/download/file?token=${encodeURIComponent(context.auditArchiveDownloadToken)}`,
      missing: null,
    };
  }

  if (path.includes("/api/auth/register/:inviteCode")) {
    const next = replacePathParam(path, ":inviteCode", context.registerInviteCode);
    if (!next) {
      return { path, missing: "register invite code" };
    }
    path = next;
  }

  if (path.includes("/api/users/:id")) {
    const selfOnly =
      endpoint.path.includes("/change-password") ||
      endpoint.path.includes("/change-username");
    const userId = selfOnly ? context.meId : context.targetUserId ?? context.meId;
    const next = replacePathParam(path, ":id", userId);
    if (!next) {
      return { path, missing: "user id" };
    }
    path = next;
  }

  if (path.includes("/api/users/") && path.includes(":key")) {
    const next = replacePathParam(path, ":key", context.userImageKey);
    if (!next) {
      return { path, missing: "uploaded image key" };
    }
    path = next;
  }

  if (path.includes("/api/events/:id")) {
    const mutable =
      endpoint.label === "Update Event" ||
      endpoint.label === "Join Event" ||
      endpoint.label === "Leave Event" ||
      endpoint.label === "Add Participant" ||
      endpoint.label === "Remove Participant" ||
      endpoint.label === "Archive Event" ||
      endpoint.label === "Destroy Event" ||
      endpoint.label === "Upload Event Images";
    const eventId = mutable ? context.createdEventId ?? context.eventId : context.eventId ?? context.createdEventId;
    const next = replacePathParam(path, ":id", eventId);
    if (!next) {
      return { path, missing: "event id" };
    }
    path = next;
  }

  if (path.includes("/api/events/templates/:id")) {
    const next = replacePathParam(path, ":id", context.eventTemplateId);
    if (!next) {
      return { path, missing: "template id" };
    }
    path = next;
  }

  if (path.includes("/api/events/") && path.includes(":userId")) {
    const participantId = context.eventParticipantUserId ?? context.targetUserId ?? context.meId;
    const next = replacePathParam(path, ":userId", participantId);
    if (!next) {
      return { path, missing: "participant user id" };
    }
    path = next;
  }

  if (path.includes("/api/announcements/:id")) {
    const next = replacePathParam(path, ":id", context.announcementId);
    if (!next) {
      return { path, missing: "announcement id" };
    }
    path = next;
  }

  if (path.includes("/api/gallery/:id")) {
    const galleryId =
      endpoint.label === "Delete Item"
        ? context.galleryDeleteId ?? context.galleryItemId
        : context.galleryItemId ?? context.galleryDeleteId;
    const next = replacePathParam(path, ":id", galleryId);
    if (!next) {
      return { path, missing: "gallery item id" };
    }
    path = next;
  }

  if (path.includes("/api/gallery/") && path.includes(":commentId")) {
    const next = replacePathParam(path, ":commentId", context.galleryCommentId);
    if (!next) {
      return { path, missing: "gallery comment id" };
    }
    path = next;
  }

  if (path.includes("/api/guild-war/history/:id")) {
    const next = replacePathParam(path, ":id", context.warHistoryId);
    if (!next) {
      return { path, missing: "guild war history id" };
    }
    path = next;
  }

  if (path.includes("/api/guild-war/history/") && path.includes(":userId")) {
    const next = replacePathParam(path, ":userId", context.warMemberUserId);
    if (!next) {
      return { path, missing: "guild war member user id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/audit-archive/:month")) {
    const next = replacePathParam(path, ":month", context.auditArchiveMonth);
    if (!next) {
      return { path, missing: "archive month (run archive months first)" };
    }
    path = next;
  }

  if (path.includes("/api/wiki/categories/:id")) {
    const next = replacePathParam(path, ":id", context.wikiCategoryId);
    if (!next) {
      return { path, missing: "wiki category id" };
    }
    path = next;
  }

  if (path.includes("/api/wiki/articles/:slug")) {
    const next = replacePathParam(path, ":slug", context.wikiArticleSlug);
    if (!next) {
      return { path, missing: "wiki article slug" };
    }
    path = next;
  }

  if (path.includes("/api/wiki/articles/:id")) {
    const next = replacePathParam(path, ":id", context.wikiArticleId);
    if (!next) {
      return { path, missing: "wiki article id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/invite-links/:id")) {
    const next = replacePathParam(path, ":id", context.inviteLinkId);
    if (!next) {
      return { path, missing: "invite id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/users/:id")) {
    const userId = context.adminCreatedUserId;
    const next = replacePathParam(path, ":id", userId);
    if (!next) {
      return { path, missing: "admin target user id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/roles/:id")) {
    const next = replacePathParam(path, ":id", context.adminRoleId);
    if (!next) {
      return { path, missing: "admin role id" };
    }
    path = next;
  }

  return { path, missing: null };
}

export function prepareEndpointRequest(endpoint: EndpointDef, context: TestRunContext): PreparedEndpointRequest {
  const resolved = resolveEndpointPath(endpoint, context);
  if (resolved.missing) {
    return skipEndpoint(endpoint.path, `Missing ${resolved.missing}`);
  }
  const path = resolved.path;

  if (endpoint.method === "GET" || endpoint.method === "DELETE") {
    return { path };
  }

  const nowId = Date.now();
  switch (`${endpoint.method} ${endpoint.path}`) {
    case "PATCH /api/admin/analytics-settings":
      return buildJsonRequest(path, {
        reference_duration_minutes: 30,
        modifier_weight_kda: 0.3,
        modifier_weight_towers: 0.1,
        modifier_weight_credits: 0.3,
        modifier_weight_distance: 0.15,
        modifier_weight_basehp: 0.15,
      });

    case "POST /api/auth/register/:inviteCode":
      return {
        ...buildJsonRequest(path, {
        username: `systemtest_${nowId}`,
        password: "Passw0rd!",
        confirmPassword: "Passw0rd!",
        }),
        // Prevent this guest-flow endpoint from replacing the current admin session.
        credentials: "omit",
      };

    case "PATCH /api/users/:id/profile":
      return buildJsonRequest(path, {
        bio: "[systemtest] API test profile update",
        classes: ["鸣金虹"],
      });

    case "POST /api/users/:id/media/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/users/:id/media/audio":
      return buildFormRequest(path, [["file", createTinyAudioFile()]]);

    case "POST /api/users/:id/change-password":
      return skipEndpoint(path, "Requires current user password");

    case "POST /api/users/:id/change-username":
      return skipEndpoint(path, "Requires current user password");

    case "POST /api/events":
      return buildJsonRequest(path, {
        type: "weekly_mission",
        title: `[systemtest] API Test Event ${nowId}`,
        description: "[systemtest] Created by admin API tester",
        start_at: toIso(2),
        end_at: toIso(3),
        capacity: 20,
      });

    case "PATCH /api/events/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Updated Event ${nowId}`,
      });

    case "POST /api/events/:id/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/events/:id/participants":
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing participant user id");
      }
      return buildJsonRequest(path, {
        user_id: context.targetUserId ?? context.meId,
      });

    case "POST /api/events/templates":
      return buildJsonRequest(path, {
        type: "social",
        title: `[systemtest] API Template ${nowId}`,
        description: "[systemtest] Recurring template from API tester",
        start_at: toIso(4),
        end_at: toIso(5),
        recurrence_rule: {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [1],
        },
      });

    case "PATCH /api/events/templates/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Template Updated ${nowId}`,
      });

    case "POST /api/announcements":
      return buildJsonRequest(path, {
        title: `[systemtest] API Announcement ${nowId}`,
        body_json: "{\"content\":\"[systemtest] Created by API tester\"}",
        pinned: false,
        status: "draft",
      });

    case "PATCH /api/announcements/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Announcement Updated ${nowId}`,
        body_json: "{\"content\":\"[systemtest] Updated by API tester\"}",
      });

    case "POST /api/announcements/:id/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/gallery/images":
      return buildFormRequest(path, [
        ["file", createTinyPngFile()],
        ["captions", "[systemtest] API test image"],
      ]);

    case "POST /api/gallery/videos":
      return buildJsonRequest(path, {
        type: "video",
        url: "https://example.com/video.mp4",
        caption: "[systemtest] API test video",
      });

    case "POST /api/gallery/:id/comments":
      return buildJsonRequest(path, {
        body: "[systemtest] API test comment",
      });

    case "PATCH /api/gallery/:id/comments/:commentId":
      return buildJsonRequest(path, {
        body: "[systemtest] API test comment (edited)",
      });

    case "POST /api/guild-war/save-teams":
      if (!context.warEventId && !context.eventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing event id for guild war teams");
      }
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing user id for guild war teams");
      }
      return buildJsonRequest(path, {
        event_id: context.warEventId ?? context.eventId ?? context.createdEventId,
        teams: [
          {
            team_name: "[systemtest] API Team A",
            sort_order: 0,
            is_locked: false,
            members: [
              {
                user_id: context.targetUserId ?? context.meId,
                sort_order: 0,
              },
            ],
          },
        ],
        pool_members: [],
      });

    case "POST /api/guild-war/move":
      if (!context.warEventId && !context.eventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing event id for guild war move");
      }
      if (!context.warMemberUserId && !context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing member user id for guild war move");
      }
      return buildJsonRequest(path, {
        event_id: context.warEventId ?? context.eventId ?? context.createdEventId,
        user_id: context.warMemberUserId ?? context.targetUserId ?? context.meId,
        to: "pool",
      });

    case "PATCH /api/guild-war/role-tag":
      if (!context.warEventId && !context.eventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing event id for role tag");
      }
      if (!context.warMemberUserId) {
        return skipEndpoint(path, "Missing active war member user id for role tag");
      }
      return buildJsonRequest(path, {
        event_id: context.warEventId ?? context.eventId ?? context.createdEventId,
        user_id: context.warMemberUserId,
        role_tag: "DPS",
      });

    case "POST /api/guild-war/history":
      return buildJsonRequest(path, {
        event_id: context.warEventId ?? context.eventId ?? context.createdEventId ?? undefined,
        war_name: `[systemtest] API Test War ${nowId}`,
        result: "win",
      });

    case "PATCH /api/guild-war/history/:id":
      return buildJsonRequest(path, {
        notes: "[systemtest] API test history update",
      });

    case "PATCH /api/guild-war/history/:id/member-stats/:userId":
      return buildJsonRequest(path, {
        kills: 1,
      });

    case "POST /api/wiki/categories":
      return buildJsonRequest(path, {
        name: `[systemtest] API Category ${nowId}`,
        sort_order: 0,
      });

    case "PATCH /api/wiki/categories/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Category Updated ${nowId}`,
      });

    case "POST /api/wiki/articles":
      if (!context.wikiArticleCategoryId && !context.wikiCategoryId) {
        return skipEndpoint(path, "Missing wiki category id");
      }
      return buildJsonRequest(path, {
        title: `[systemtest] API Article ${nowId}`,
        category_id: context.wikiArticleCategoryId ?? context.wikiCategoryId,
        body_json: "{\"content\":\"[systemtest] Created by API tester\"}",
        sort_order: 0,
      });

    case "PATCH /api/wiki/articles/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Article Updated ${nowId}`,
      });

    case "POST /api/wiki/articles/:id/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/admin/invite-links":
      return buildJsonRequest(path, {
        max_uses: 1,
      });

    case "POST /api/admin/users":
      return buildJsonRequest(path, {
        username: `systemtest_admin_${nowId}`,
      });

    case "PATCH /api/admin/users/batch/role":
      if (!context.adminCreatedUserId) {
        return skipEndpoint(path, "Missing created admin user id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.adminCreatedUserId],
        new_role: "member",
      });

    case "PATCH /api/admin/users/batch/deactivate":
      if (!context.adminCreatedUserId) {
        return skipEndpoint(path, "Missing created admin user id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.adminCreatedUserId],
      });

    case "PATCH /api/admin/users/batch/reactivate":
      if (!context.adminCreatedUserId) {
        return skipEndpoint(path, "Missing created admin user id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.adminCreatedUserId],
      });

    case "PATCH /api/admin/users/batch/delete":
      if (!context.adminCreatedUserId) {
        return skipEndpoint(path, "Missing created admin user id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.adminCreatedUserId],
      });

    case "PATCH /api/admin/users/:id/role":
      return buildJsonRequest(path, {
        role: "member",
      });

    case "PATCH /api/admin/users/:id/deactivate":
      return buildJsonRequest(path, {
        reason: "[systemtest] API test deactivate",
      });

    case "PATCH /api/admin/users/:id/reactivate":
      return buildJsonRequest(path, {
        reason: "[systemtest] API test reactivate",
      });

    case "POST /api/admin/users/:id/reset-password":
      return buildJsonRequest(path, {
        temporary_password: "TempPass123!",
      });

    case "POST /api/admin/roles":
      return buildJsonRequest(path, {
        id: `systemtest_role_${nowId}`,
        name: `[systemtest] API Role ${nowId}`,
        level: 1,
        color: "#228be6",
      });

    case "PATCH /api/admin/roles/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Role Updated ${nowId}`,
      });

    default:
      return { path };
  }
}

export function captureContextFromResponse(
  previous: TestRunContext,
  endpoint: EndpointDef,
  result: EndpointResult,
): TestRunContext {
  if (!result.status || result.status < 200 || result.status >= 300 || result.parsedJson === null) {
    return previous;
  }

  const next: TestRunContext = { ...previous };
  const payload = result.parsedJson as Record<string, unknown>;

  if (endpoint.path === "/api/auth/me") {
    const user = isRecord(payload.user) ? payload.user : null;
    const profile = isRecord(payload.profile) ? payload.profile : null;
    next.meId = readString(user?.id) ?? next.meId;
    next.meUsername = readString(user?.username) ?? next.meUsername;
    const profileImages = Array.isArray(profile?.images) ? profile.images : [];
    const firstImage = profileImages.find((item): item is string => typeof item === "string");
    next.userImageKey = firstImage ?? next.userImageKey;
    next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    return next;
  }

  if (endpoint.path === "/api/auth/register/:inviteCode") {
    const userId = readString(payload.user_id) ?? readString((isRecord(payload.user) ? payload.user : null)?.id);
    next.registeredUserId = userId ?? next.registeredUserId;
    return next;
  }

  if (endpoint.path === "/api/users?page=1&limit=5") {
    if (Array.isArray(payload.data)) {
      const firstCandidate = payload.data.find((item): item is Record<string, unknown> => {
        if (!isRecord(item) || !isRecord(item.user)) {
          return false;
        }
        const userId = readString(item.user.id);
        return userId !== null && userId !== next.meId;
      });
      const first = (firstCandidate ?? firstArrayItem(payload.data)) ?? null;
      if (!first) return next;
      const user = isRecord(first.user) ? first.user : null;
      const profile = isRecord(first.profile) ? first.profile : null;
      const firstUserId = readString(user?.id);
      if (firstUserId && firstUserId !== next.meId) {
        next.targetUserId = firstUserId;
      }
      const images = Array.isArray(profile?.images) ? profile.images : [];
      const firstImage = images.find((item): item is string => typeof item === "string");
      next.userImageKey = firstImage ?? next.userImageKey;
      next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    }
    return next;
  }

  if (endpoint.path === "/api/users/:id") {
    const user = isRecord(payload.user) ? payload.user : null;
    const profile = isRecord(payload.profile) ? payload.profile : null;
    const userId = readString(user?.id);
    if (userId && userId !== next.meId) {
      next.targetUserId = userId;
    }
    const images = Array.isArray(profile?.images) ? profile.images : [];
    const firstImage = images.find((item): item is string => typeof item === "string");
    next.userImageKey = firstImage ?? next.userImageKey;
    next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    // Capture profile snapshot for cleanup restore (before PATCH modifies it)
    if (profile && !next.targetProfileSnapshot) {
      const bio = typeof profile.bio === "string" ? profile.bio : null;
      const classes = Array.isArray(profile.classes) ? profile.classes.filter((c): c is string => typeof c === "string") : [];
      next.targetProfileSnapshot = { bio, classes };
    }
    return next;
  }

  if (endpoint.path === "/api/users/:id/media/images") {
    const firstKey = Array.isArray(payload.keys)
      ? payload.keys.find((item): item is string => typeof item === "string")
      : null;
    next.userImageKey = firstKey ?? next.userImageKey;
    return next;
  }

  if (endpoint.path === "/api/users/:id/media/audio") {
    next.userAudioKey = readString(payload.key) ?? next.userAudioKey;
    return next;
  }

  if (endpoint.path === "/api/events?page=1&limit=5") {
    const firstEvent = firstArrayItem(payload.data);
    next.eventId = readString(firstEvent?.id) ?? next.eventId;
    return next;
  }

  if (endpoint.path === "/api/events") {
    next.createdEventId = readString(payload.id) ?? next.createdEventId;
    return next;
  }

  if (endpoint.path === "/api/events/templates/list") {
    const firstTemplate = firstArrayItem(payload.data);
    next.eventTemplateId = readString(firstTemplate?.id) ?? next.eventTemplateId;
    return next;
  }

  if (endpoint.path === "/api/events/templates") {
    next.eventTemplateId = readString(payload.id) ?? next.eventTemplateId;
    return next;
  }

  if (endpoint.path === "/api/events/:id/participants") {
    next.eventParticipantUserId = readString(payload.user_id) ?? next.eventParticipantUserId;
    return next;
  }

  if (endpoint.path === "/api/announcements?page=1&limit=5") {
    const firstAnnouncement = firstArrayItem(payload.data);
    next.announcementId = readString(firstAnnouncement?.id) ?? next.announcementId;
    return next;
  }

  if (endpoint.path === "/api/announcements" && endpoint.method === "POST") {
    const id = readString(payload.id);
    next.announcementId = id ?? next.announcementId;
    next.createdAnnouncementId = id ?? next.createdAnnouncementId;
    return next;
  }

  if (endpoint.path === "/api/gallery?limit=5") {
    const firstItem = firstArrayItem(payload.data);
    next.galleryItemId = readString(firstItem?.id) ?? next.galleryItemId;
    return next;
  }

  if (endpoint.path === "/api/gallery/images") {
    const firstItem = firstArrayItem(payload.data);
    const itemId = readString(firstItem?.id);
    next.galleryItemId = itemId ?? next.galleryItemId;
    next.createdGalleryImageId = itemId ?? next.createdGalleryImageId;
    return next;
  }

  if (endpoint.path === "/api/gallery/videos") {
    next.galleryDeleteId = readString(payload.id) ?? next.galleryDeleteId;
    return next;
  }

  if (endpoint.path === "/api/gallery/:id/comments") {
    next.galleryCommentId = readString(payload.id) ?? next.galleryCommentId;
    return next;
  }

  if (endpoint.path === "/api/guild-war/active") {
    const event = isRecord(payload.event) ? payload.event : null;
    next.warEventId = readString(event?.id) ?? next.warEventId;
    if (Array.isArray(payload.teams)) {
      const firstTeam = payload.teams.find((item): item is Record<string, unknown> => isRecord(item));
      if (firstTeam) {
        next.warTeamId = readString(firstTeam.id) ?? next.warTeamId;
        if (Array.isArray(firstTeam.members)) {
          const firstMember = firstTeam.members.find((item): item is Record<string, unknown> => isRecord(item));
          next.warMemberUserId = readString(firstMember?.user_id) ?? next.warMemberUserId;
        }
      }
    }
    return next;
  }

  if (endpoint.path === "/api/guild-war/history?page=1&limit=5") {
    const firstHistory = firstArrayItem(payload.data);
    next.warHistoryId = readString(firstHistory?.id) ?? next.warHistoryId;
    next.warEventId = readString(firstHistory?.event_id) ?? next.warEventId;
    return next;
  }

  if (endpoint.path === "/api/guild-war/history" && endpoint.method === "POST") {
    const id = readString(payload.id);
    next.warHistoryId = id ?? next.warHistoryId;
    next.warEventId = readString(payload.event_id) ?? next.warEventId;
    next.createdWarHistoryId = id ?? next.createdWarHistoryId;
    return next;
  }

  if (endpoint.path === "/api/wiki/categories") {
    if (Array.isArray(payload)) {
      const firstCategory = payload.find((item): item is Record<string, unknown> => isRecord(item));
      next.wikiCategoryId = readString(firstCategory?.id) ?? next.wikiCategoryId;
    } else {
      const id = readString(payload.id);
      next.wikiCategoryId = id ?? next.wikiCategoryId;
      if (endpoint.method === "POST") {
        next.createdWikiCategoryId = id ?? next.createdWikiCategoryId;
      }
    }
    return next;
  }

  if (endpoint.path === "/api/wiki/articles?page=1&limit=5") {
    const firstArticle = firstArrayItem(payload.data);
    next.wikiArticleId = readString(firstArticle?.id) ?? next.wikiArticleId;
    next.wikiArticleSlug = readString(firstArticle?.slug) ?? next.wikiArticleSlug;
    next.wikiArticleCategoryId = readString(firstArticle?.category_id) ?? next.wikiArticleCategoryId;
    return next;
  }

  if (endpoint.path === "/api/wiki/articles" && endpoint.method === "POST") {
    const id = readString(payload.id);
    next.wikiArticleId = id ?? next.wikiArticleId;
    next.wikiArticleSlug = readString(payload.slug) ?? next.wikiArticleSlug;
    next.wikiArticleCategoryId = readString(payload.category_id) ?? next.wikiArticleCategoryId;
    next.createdWikiArticleId = id ?? next.createdWikiArticleId;
    return next;
  }

  if (endpoint.path === "/api/admin/invite-links") {
    if (Array.isArray(payload)) {
      const firstInvite = payload.find((item): item is Record<string, unknown> => isRecord(item));
      next.registerInviteCode = readString(firstInvite?.code) ?? next.registerInviteCode;
    } else {
      if (endpoint.method === "POST") {
        const id = readString(payload.id);
        next.inviteLinkId = id ?? next.inviteLinkId;
        next.createdInviteLinkId = id ?? next.createdInviteLinkId;
      }
      next.registerInviteCode = readString(payload.code) ?? next.registerInviteCode;
    }
    return next;
  }

  if (endpoint.path === "/api/admin/users") {
    next.adminCreatedUserId = readString(payload.user_id) ?? next.adminCreatedUserId;
    next.adminCreatedUserPassword = readString(payload.temporary_password) ?? next.adminCreatedUserPassword;
    return next;
  }

  if (endpoint.path === "/api/admin/roles") {
    if (Array.isArray(payload)) {
      const customRole = payload.find(
        (item): item is Record<string, unknown> => isRecord(item) && item.is_builtin === false,
      );
      next.adminRoleId = readString(customRole?.id) ?? next.adminRoleId;
    } else {
      const id = readString(payload.id);
      next.adminRoleId = id ?? next.adminRoleId;
      if (endpoint.method === "POST") {
        next.createdRoleId = id ?? next.createdRoleId;
      }
    }
    return next;
  }

  if (endpoint.path === "/api/admin/audit-archive/months") {
    if (Array.isArray(payload.months)) {
      const month = payload.months.find((item): item is string => typeof item === "string");
      next.auditArchiveMonth = month ?? next.auditArchiveMonth;
    }
    return next;
  }

  if (endpoint.path === "/api/admin/audit-archive/download") {
    if (Array.isArray(payload.files)) {
      const firstFile = payload.files.find((item): item is Record<string, unknown> => isRecord(item));
      const rawUrl = readString(firstFile?.url);
      if (rawUrl) {
        const url = new URL(rawUrl, window.location.origin);
        next.auditArchiveDownloadToken = url.searchParams.get("token") ?? next.auditArchiveDownloadToken;
      }
    }
    return next;
  }

  return next;
}

export function methodColor(method: string): string {
  switch (method) {
    case "GET":
      return "blue";
    case "POST":
      return "green";
    case "PATCH":
      return "yellow";
    case "DELETE":
      return "red";
    default:
      return "gray";
  }
}

export function statusColor(status: number | null): string {
  if (status === null) return "gray";
  if (status >= 200 && status < 300) return "green";
  if (status >= 400 && status < 500) return "yellow";
  return "red";
}

export function truncateJson(json: string, maxLen = 2000): string {
  if (json.length <= maxLen) return json;
  return `${json.slice(0, maxLen)}\n... (truncated)`;
}

export async function runEndpointTest(
  endpoint: EndpointDef,
  prepared: PreparedEndpointRequest,
  signal?: AbortSignal,
): Promise<EndpointResult> {
  const ranAt = new Date().toISOString();
  if (prepared.skipReason) {
    return {
      status: null,
      latencyMs: 0,
      body: prepared.skipReason,
      error: "Skipped",
      ranAt,
      parsedJson: null,
    };
  }

  const started = performance.now();
  try {
    const response = await fetch(prepared.path, {
      method: endpoint.method,
      credentials: prepared.credentials ?? "include",
      signal,
      headers: prepared.headers,
      body: prepared.body,
    });
    const latencyMs = Math.round(performance.now() - started);
    let body: string;
    let parsedJson: unknown | null = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const raw = await response.text();
      if (raw) {
        const json = JSON.parse(raw) as unknown;
        body = JSON.stringify(json, null, 2);
        parsedJson = json;
      } else {
        body = "";
      }
    } else {
      body = await response.text();
    }
    return {
      status: response.status,
      latencyMs,
      body: truncateJson(body),
      error: response.ok ? null : `${response.status} ${response.statusText}`,
      ranAt,
      parsedJson,
    };
  } catch (err) {
    if (signal?.aborted) {
      return { status: null, latencyMs: 0, body: "", error: "Aborted", ranAt, parsedJson: null };
    }
    const latencyMs = Math.round(performance.now() - started);
    return {
      status: null,
      latencyMs,
      body: "",
      error: err instanceof Error ? err.message : "Unknown error",
      ranAt,
      parsedJson: null,
    };
  }
}

let logIdCounter = 0;
export function nextLogId(): string {
  logIdCounter += 1;
  return `log-${Date.now()}-${logIdCounter}`;
}
