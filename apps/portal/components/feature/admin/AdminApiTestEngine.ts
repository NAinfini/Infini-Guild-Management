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
  eventParticipantUserId: string | null;
  pollOptionId: string | null;
  eventTemplateId: string | null;
  announcementId: string | null;
  galleryItemId: string | null;
  galleryDeleteId: string | null;
  warEventId: string | null;
  warHistoryId: string | null;
  warTeamId: string | null;
  warMemberUserId: string | null;
  createdConcludedWarHistoryId: string | null;
  wikiCategoryId: string | null;
  wikiArticleId: string | null;
  wikiArticleSlug: string | null;
  wikiArticleCategoryId: string | null;
  inviteLinkId: string | null;
  adminCreatedUserId: string | null;
  adminCreatedUsername: string | null;
  adminCreatedUserPassword: string | null;
  adminRoleId: string | null;
  auditArchiveMonth: string | null;
  auditArchiveDownloadToken: string | null;
  badgeId: string | null;
  eventImageKey: string | null;
  announcementImageKey: string | null;
  galleryImageKey: string | null;
  wikiImageKey: string | null;
  /** Key of the image uploaded by the test (for cleanup) */
  uploadedImageKey: string | null;
  registeredUserId: string | null;
  registeredUsername: string | null;
  registeredUserPassword: string | null;
  createdInviteLinkId: string | null;
  createdAnnouncementId: string | null;
  createdGalleryImageId: string | null;
  createdGalleryVideoId: string | null;
  createdWikiCategoryId: string | null;
  createdWikiArticleId: string | null;
  createdWarHistoryId: string | null;
  createdSaveTeamsHistoryId: string | null;
  createdGuildWarEventId: string | null;
  createdRoleId: string | null;
  createdBadgeId: string | null;
  createdEventId: string | null;
  createdPollEventId: string | null;
  createdRaffleEventId: string | null;
  createdTemplateId: string | null;
  /** Snapshot of target user's profile before modification, for cleanup restore */
  targetProfileSnapshot: { bio: string | null; classes: string[] } | null;
};

export type PreparedEndpointRequest = {
  path: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  credentials?: RequestCredentials;
  skipReason?: string;
  optionalSkip?: boolean;
};

export type EndpointResult = {
  status: number | null;
  latencyMs: number;
  body: string;
  error: string | null;
  ranAt: string;
  parsedJson: unknown | null;
  skipped?: boolean;
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
  skipped?: boolean;
};

export type CleanupStep = {
  label: string;
  method: EndpointDef["method"];
  path: string;
  jsonBody?: unknown;
  clearContext?: Partial<TestRunContext>;
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
    eventParticipantUserId: null,
    pollOptionId: null,
    eventTemplateId: null,
    announcementId: null,
    galleryItemId: null,
    galleryDeleteId: null,
    warEventId: null,
    warHistoryId: null,
    warTeamId: null,
    warMemberUserId: null,
    createdConcludedWarHistoryId: null,
    wikiCategoryId: null,
    wikiArticleId: null,
    wikiArticleSlug: null,
    wikiArticleCategoryId: null,
    inviteLinkId: null,
    adminCreatedUserId: null,
    adminCreatedUsername: null,
    adminCreatedUserPassword: null,
    adminRoleId: null,
    auditArchiveMonth: null,
    auditArchiveDownloadToken: null,
    badgeId: null,
    eventImageKey: null,
    announcementImageKey: null,
    galleryImageKey: null,
    wikiImageKey: null,
    uploadedImageKey: null,
    registeredUserId: null,
    registeredUsername: null,
    registeredUserPassword: null,
    createdInviteLinkId: null,
    createdAnnouncementId: null,
    createdGalleryImageId: null,
    createdGalleryVideoId: null,
    createdWikiCategoryId: null,
    createdWikiArticleId: null,
    createdWarHistoryId: null,
    createdSaveTeamsHistoryId: null,
    createdGuildWarEventId: null,
    createdRoleId: null,
    createdBadgeId: null,
    createdEventId: null,
    createdPollEventId: null,
    createdRaffleEventId: null,
    createdTemplateId: null,
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

export function isProfileMediaKey(value: string | null): value is string {
  return typeof value === "string" && value.startsWith("members/");
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

export function skipEndpoint(path: string, reason: string, optionalSkip = false): PreparedEndpointRequest {
  return { path, skipReason: reason, optionalSkip };
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

export function buildCleanupSteps(ctx: TestRunContext): CleanupStep[] {
  const cleanupSteps: CleanupStep[] = [];

  if (ctx.createdBadgeId) {
    cleanupSteps.push({
      label: "Cleanup: Badge",
      method: "DELETE",
      path: `/api/badges/${encodeURIComponent(ctx.createdBadgeId)}`,
      clearContext: { createdBadgeId: null },
    });
  }
  if (ctx.createdGalleryVideoId) {
    cleanupSteps.push({
      label: "Cleanup: Gallery Video",
      method: "DELETE",
      path: `/api/gallery/${encodeURIComponent(ctx.createdGalleryVideoId)}`,
      clearContext: { createdGalleryVideoId: null },
    });
  }
  if (ctx.createdGalleryImageId) {
    cleanupSteps.push({
      label: "Cleanup: Gallery Image",
      method: "DELETE",
      path: `/api/gallery/${encodeURIComponent(ctx.createdGalleryImageId)}`,
      clearContext: { createdGalleryImageId: null },
    });
  }
  if (ctx.createdAnnouncementId) {
    cleanupSteps.push({
      label: "Cleanup: Announcement",
      method: "DELETE",
      path: `/api/announcements/${encodeURIComponent(ctx.createdAnnouncementId)}/permanent`,
      clearContext: { createdAnnouncementId: null },
    });
  }
  if (ctx.createdWikiArticleId) {
    cleanupSteps.push({
      label: "Cleanup: Wiki Article",
      method: "DELETE",
      path: `/api/wiki/articles/${encodeURIComponent(ctx.createdWikiArticleId)}/permanent`,
      clearContext: { createdWikiArticleId: null },
    });
  }
  if (ctx.createdWikiCategoryId) {
    cleanupSteps.push({
      label: "Cleanup: Wiki Category",
      method: "DELETE",
      path: `/api/wiki/categories/${encodeURIComponent(ctx.createdWikiCategoryId)}`,
      clearContext: { createdWikiCategoryId: null },
    });
  }
  if (ctx.createdWarHistoryId) {
    cleanupSteps.push({
      label: "Cleanup: War History",
      method: "DELETE",
      path: `/api/guild-war/history/${encodeURIComponent(ctx.createdWarHistoryId)}`,
      clearContext: {
        createdWarHistoryId: null,
        ...(ctx.createdSaveTeamsHistoryId === ctx.createdWarHistoryId ? { createdSaveTeamsHistoryId: null } : {}),
      },
    });
  }
  if (ctx.createdConcludedWarHistoryId) {
    cleanupSteps.push({
      label: "Cleanup: Concluded War History",
      method: "DELETE",
      path: `/api/guild-war/history/${encodeURIComponent(ctx.createdConcludedWarHistoryId)}`,
      clearContext: { createdConcludedWarHistoryId: null },
    });
  }
  if (ctx.createdSaveTeamsHistoryId && ctx.createdSaveTeamsHistoryId !== ctx.createdWarHistoryId) {
    cleanupSteps.push({
      label: "Cleanup: Save-Teams History",
      method: "DELETE",
      path: `/api/guild-war/history/${encodeURIComponent(ctx.createdSaveTeamsHistoryId)}`,
      clearContext: { createdSaveTeamsHistoryId: null },
    });
  }
  if (ctx.createdTemplateId) {
    cleanupSteps.push({
      label: "Cleanup: Event Template",
      method: "DELETE",
      path: `/api/events/templates/${encodeURIComponent(ctx.createdTemplateId)}`,
      clearContext: { createdTemplateId: null },
    });
  }
  if (ctx.createdGuildWarEventId && ctx.createdGuildWarEventId !== ctx.createdEventId) {
    cleanupSteps.push({
      label: "Cleanup: Archive Guild War Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdGuildWarEventId)}`,
    });
    cleanupSteps.push({
      label: "Cleanup: Destroy Guild War Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdGuildWarEventId)}/destroy`,
      clearContext: { createdGuildWarEventId: null },
    });
  }
  if (ctx.createdPollEventId) {
    cleanupSteps.push({
      label: "Cleanup: Poll Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdPollEventId)}/destroy`,
      clearContext: { createdPollEventId: null, pollOptionId: null },
    });
  }
  if (ctx.createdRaffleEventId) {
    cleanupSteps.push({
      label: "Cleanup: Raffle Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdRaffleEventId)}/destroy`,
      clearContext: { createdRaffleEventId: null },
    });
  }
  if (ctx.createdEventId) {
    cleanupSteps.push({
      label: "Cleanup: Archive Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdEventId)}`,
    });
    cleanupSteps.push({
      label: "Cleanup: Destroy Event",
      method: "DELETE",
      path: `/api/events/${encodeURIComponent(ctx.createdEventId)}/destroy`,
      clearContext: { createdEventId: null },
    });
  }
  if (ctx.createdInviteLinkId) {
    cleanupSteps.push({
      label: "Cleanup: Invite Link",
      method: "DELETE",
      path: `/api/admin/invite-links/${encodeURIComponent(ctx.createdInviteLinkId)}/permanent`,
      clearContext: { createdInviteLinkId: null },
    });
  }
  if (ctx.createdRoleId) {
    cleanupSteps.push({
      label: "Cleanup: Admin Role",
      method: "DELETE",
      path: `/api/admin/roles/${encodeURIComponent(ctx.createdRoleId)}`,
      clearContext: { createdRoleId: null },
    });
  }
  if (ctx.meId && ctx.targetProfileSnapshot) {
    cleanupSteps.push({
      label: "Cleanup: Restore Profile",
      method: "PATCH",
      path: `/api/users/${encodeURIComponent(ctx.meId)}/profile`,
      jsonBody: {
        bio: ctx.targetProfileSnapshot.bio,
        classes: ctx.targetProfileSnapshot.classes,
      },
      clearContext: { targetProfileSnapshot: null },
    });
  }
  if (ctx.meId && ctx.uploadedImageKey) {
    cleanupSteps.push({
      label: "Cleanup: Test Image",
      method: "DELETE",
      path: `/api/users/${encodeURIComponent(ctx.meId)}/media/images`,
      jsonBody: { keys: [ctx.uploadedImageKey] },
      clearContext: { uploadedImageKey: null },
    });
  }
  if (ctx.registeredUserId) {
    cleanupSteps.push({
      label: "Cleanup: Registered User",
      method: "PATCH",
      path: "/api/admin/users/batch/delete",
      jsonBody: { user_ids: [ctx.registeredUserId] },
      clearContext: {
        registeredUserId: null,
        ...(ctx.adminCreatedUserId === ctx.registeredUserId
          ? { adminCreatedUserId: null, adminCreatedUsername: null, adminCreatedUserPassword: null }
          : {}),
      },
    });
  }
  if (ctx.adminCreatedUserId && ctx.adminCreatedUserId !== ctx.registeredUserId) {
    cleanupSteps.push({
      label: "Cleanup: Admin Created User",
      method: "PATCH",
      path: "/api/admin/users/batch/delete",
      jsonBody: { user_ids: [ctx.adminCreatedUserId] },
      clearContext: { adminCreatedUserId: null, adminCreatedUsername: null, adminCreatedUserPassword: null },
    });
  }

  return cleanupSteps;
}

export type StaleArtifactProbe = {
  label: string;
  path: string;
};

export const STALE_ARTIFACT_PROBES: StaleArtifactProbe[] = [
  { label: "Users", path: "/api/users?search=%5Bsystemtest%5D&active=false&limit=20" },
  { label: "Events", path: "/api/events?search=%5Bsystemtest%5D&archived=true&limit=20" },
  { label: "Announcements", path: "/api/announcements?search=%5Bsystemtest%5D&archived=true&limit=20" },
  { label: "Gallery", path: "/api/gallery?search=%5Bsystemtest%5D&limit=20" },
  { label: "Wiki", path: "/api/wiki/articles?search=%5Bsystemtest%5D&page=1&limit=20" },
  { label: "Roles", path: "/api/admin/roles" },
  { label: "Badges", path: "/api/badges" },
];

export function countStaleSystemTestArtifacts(label: string, payload: unknown): number {
  const marker = "[systemtest]";
  const containsMarker = (value: unknown): boolean => JSON.stringify(value).toLowerCase().includes(marker);
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(containsMarker).length;
  }
  if (Array.isArray(payload)) {
    return payload.filter(containsMarker).length;
  }
  if (label === "Users" && isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(containsMarker).length;
  }
  return containsMarker(payload) ? 1 : 0;
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
        { label: t("status.api.ep.siteConfig"), method: "GET", path: "/api/site-config" },
        { label: t("status.api.ep.adminStatus"), method: "GET", path: "/api/admin/status" },
        { label: t("status.api.ep.analyticsSettings"), method: "GET", path: "/api/admin/analytics-settings" },
        { label: t("status.api.ep.updateAnalyticsSettings"), method: "PATCH", path: "/api/admin/analytics-settings" },
        { label: t("status.api.ep.dashboardSummary"), method: "GET", path: "/api/dashboard/summary" },
        { label: t("status.api.ep.globalSearch"), method: "GET", path: "/api/search?q=systemtest&limit=5" },
      ],
    },
    {
      key: "auth",
      label: t("status.api.cat.auth"),
      endpoints: [
        { label: t("status.api.ep.checkUsername"), method: "GET", path: "/api/auth/check-username?username=test" },
        { label: t("status.api.ep.currentUser"), method: "GET", path: "/api/auth/me" },
        { label: t("status.api.ep.registerInvitePrep"), method: "GET", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.createInvite"), method: "POST", path: "/api/admin/invite-links" },
        { label: t("status.api.ep.verifyInvite"), method: "GET", path: "/api/auth/verify-invite/:code" },
        { label: t("status.api.ep.register"), method: "POST", path: "/api/auth/register/:inviteCode" },
        { label: t("status.api.ep.login"), method: "POST", path: "/api/auth/login" },
        { label: t("status.api.ep.logout"), method: "POST", path: "/api/auth/logout" },
      ],
    },
    {
      key: "users",
      label: t("status.api.cat.users"),
      endpoints: [
        { label: t("status.api.ep.listUsers"), method: "GET", path: "/api/users?page=1&limit=5" },
        { label: t("status.api.ep.userStats"), method: "GET", path: "/api/users/stats" },
        { label: t("status.api.ep.getUserById"), method: "GET", path: "/api/users/:id" },
        { label: t("status.api.ep.updateProfile"), method: "PATCH", path: "/api/users/:id/profile" },
        { label: t("status.api.ep.uploadImage"), method: "POST", path: "/api/users/:id/media/images" },
        { label: t("status.api.ep.getUserImage"), method: "GET", path: "/api/users/image" },
        { label: t("status.api.ep.deleteImage"), method: "DELETE", path: "/api/users/:id/media/images" },
        { label: t("status.api.ep.uploadAvatar"), method: "POST", path: "/api/users/:id/media/avatar" },
        { label: t("status.api.ep.deleteAvatar"), method: "DELETE", path: "/api/users/:id/media/avatar" },
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
        { label: t("status.api.ep.pollVote"), method: "POST", path: "/api/events?fixture=poll" },
        { label: t("status.api.ep.getEvent"), method: "GET", path: "/api/events/:id?fixture=poll" },
        { label: t("status.api.ep.pollVote"), method: "POST", path: "/api/events/:id/poll/vote" },
        { label: t("status.api.ep.raffleDraw"), method: "POST", path: "/api/events?fixture=raffle" },
        { label: t("status.api.ep.addParticipant"), method: "POST", path: "/api/events/:id/participants?fixture=raffle" },
        { label: t("status.api.ep.raffleDraw"), method: "POST", path: "/api/events/:id/raffle/draw" },
        { label: t("status.api.ep.getEvent"), method: "GET", path: "/api/events/:id" },
        { label: t("status.api.ep.updateEvent"), method: "PATCH", path: "/api/events/:id" },
        { label: t("status.api.ep.batchEventDetails"), method: "POST", path: "/api/events/batch-details" },
        { label: t("status.api.ep.uploadEventImages"), method: "POST", path: "/api/events/:id/images" },
        { label: t("status.api.ep.getEventImage"), method: "GET", path: "/api/events/image" },
        { label: t("status.api.ep.joinEvent"), method: "POST", path: "/api/events/:id/join" },
        { label: t("status.api.ep.addParticipant"), method: "POST", path: "/api/events/:id/participants" },
        { label: t("status.api.ep.removeParticipant"), method: "DELETE", path: "/api/events/:id/participants" },
        { label: t("status.api.ep.leaveEvent"), method: "DELETE", path: "/api/events/:id/leave" },
        { label: t("status.api.ep.archiveEvent"), method: "DELETE", path: "/api/events/:id" },
        { label: t("status.api.ep.destroyEvent"), method: "DELETE", path: "/api/events/:id/destroy" },
        { label: t("status.api.ep.listTemplates"), method: "GET", path: "/api/events/templates/list" },
        { label: t("status.api.ep.createTemplate"), method: "POST", path: "/api/events/templates" },
        { label: t("status.api.ep.updateTemplate"), method: "PATCH", path: "/api/events/templates/:id" },
        { label: t("status.api.ep.pauseTemplate"), method: "POST", path: "/api/events/templates/:id/pause" },
        { label: t("status.api.ep.resumeTemplate"), method: "POST", path: "/api/events/templates/:id/resume" },
        { label: t("status.api.ep.deleteTemplate"), method: "DELETE", path: "/api/events/templates/:id" },
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
        { label: t("status.api.ep.getAnnouncementImage"), method: "GET", path: "/api/announcements/image" },
        { label: t("status.api.ep.archiveAnnouncement"), method: "DELETE", path: "/api/announcements/:id" },
        { label: t("status.api.ep.deleteAnnouncement"), method: "DELETE", path: "/api/announcements/:id/permanent" },
      ],
    },
    {
      key: "gallery",
      label: t("status.api.cat.gallery"),
      endpoints: [
        { label: t("status.api.ep.listGallery"), method: "GET", path: "/api/gallery?limit=5" },
        { label: t("status.api.ep.uploadGalleryImages"), method: "POST", path: "/api/gallery/images" },
        { label: t("status.api.ep.getGalleryImage"), method: "GET", path: "/api/gallery/image" },
        { label: t("status.api.ep.addVideo"), method: "POST", path: "/api/gallery/videos" },
        { label: t("status.api.ep.batchDeleteGallery"), method: "POST", path: "/api/gallery/batch-delete" },
        { label: t("status.api.ep.deleteGalleryItem"), method: "DELETE", path: "/api/gallery/:id" },
      ],
    },
    {
      key: "guildWar",
      label: t("status.api.cat.guildWar"),
      endpoints: [
        { label: t("status.api.ep.activeWar"), method: "GET", path: "/api/guild-war/active" },
        { label: t("status.api.ep.concludedEventIds"), method: "GET", path: "/api/guild-war/concluded-event-ids" },
        { label: t("status.api.ep.createEvent"), method: "POST", path: "/api/events?fixture=guild-war" },
        { label: t("status.api.ep.saveTeams"), method: "POST", path: "/api/guild-war/save-teams" },
        { label: t("status.api.ep.updateRoleTag"), method: "PATCH", path: "/api/guild-war/role-tag" },
        { label: t("status.api.ep.exportGuildWar"), method: "GET", path: "/api/guild-war/export?format=json" },
        { label: t("status.api.ep.warHistory"), method: "GET", path: "/api/guild-war/history?page=1&limit=5" },
        { label: t("status.api.ep.historyDetail"), method: "GET", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.batchHistoryDetails"), method: "POST", path: "/api/guild-war/history/batch" },
        { label: t("status.api.ep.moveMember"), method: "POST", path: "/api/guild-war/move" },
        { label: t("status.api.ep.createHistory"), method: "POST", path: "/api/guild-war/history" },
        { label: t("status.api.ep.analytics"), method: "GET", path: "/api/guild-war/analytics" },
        { label: t("status.api.ep.concludeWar"), method: "POST", path: "/api/guild-war/conclude" },
        { label: t("status.api.ep.updateMemberStats"), method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
        { label: t("status.api.ep.batchMemberStats"), method: "PATCH", path: "/api/guild-war/history/:id/member-stats/batch" },
        { label: t("status.api.ep.updateHistory"), method: "PATCH", path: "/api/guild-war/history/:id" },
        { label: t("status.api.ep.batchDeleteHistory"), method: "POST", path: "/api/guild-war/history/batch-delete" },
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
        { label: t("status.api.ep.getWikiImage"), method: "GET", path: "/api/wiki/image" },
        { label: t("status.api.ep.archiveArticle"), method: "DELETE", path: "/api/wiki/articles/:id" },
        { label: t("status.api.ep.deleteArticle"), method: "DELETE", path: "/api/wiki/articles/:id/permanent" },
        { label: t("status.api.ep.deleteCategory"), method: "DELETE", path: "/api/wiki/categories/:id" },
      ],
    },
    {
      key: "badges",
      label: t("status.api.cat.badges"),
      endpoints: [
        { label: t("status.api.ep.listBadges"), method: "GET", path: "/api/badges" },
        { label: t("status.api.ep.createBadge"), method: "POST", path: "/api/badges" },
        { label: t("status.api.ep.getBadge"), method: "GET", path: "/api/badges/:id" },
        { label: t("status.api.ep.updateBadge"), method: "PATCH", path: "/api/badges/:id" },
        { label: t("status.api.ep.badgeAssignments"), method: "GET", path: "/api/badges/:id/assignments" },
        { label: t("status.api.ep.assignBadge"), method: "POST", path: "/api/badges/:id/assign" },
        { label: t("status.api.ep.unassignBadge"), method: "POST", path: "/api/badges/:id/unassign" },
        { label: t("status.api.ep.deleteBadge"), method: "DELETE", path: "/api/badges/:id" },
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
        { label: t("status.api.ep.permanentDeleteInvite"), method: "DELETE", path: "/api/admin/invite-links/:id/permanent" },
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
    {
      key: "adminErrorLog",
      label: t("status.api.cat.adminErrorLog"),
      endpoints: [
        { label: t("status.api.ep.errorLog"), method: "GET", path: "/api/admin/error-log?page=1&limit=5" },
      ],
    },
  ];
}

export function filterApiCategoriesForPermissions(
  categories: CategoryDef[],
  permissions: Record<string, boolean> | null | undefined,
): CategoryDef[] {
  const canRunEndpoint = (endpoint: EndpointDef): boolean => {
    const requirement = permissionRequirementForEndpoint(endpoint);
    if (requirement.all.length > 0 && !requirement.all.every((permission) => permissions?.[permission] === true)) {
      return false;
    }
    return requirement.any.length === 0 || requirement.any.some((permission) => permissions?.[permission] === true);
  };

  return categories
    .map((category) => ({
      ...category,
      endpoints: category.endpoints.filter(canRunEndpoint),
    }))
    .filter((category) => category.endpoints.length > 0);
}

type EndpointPermissionRequirement = {
  all: string[];
  any: string[];
};

function requiresAll(...permissions: string[]): EndpointPermissionRequirement {
  return { all: permissions, any: [] };
}

function requiresAny(...permissions: string[]): EndpointPermissionRequirement {
  return { all: [], any: permissions };
}

function publicEndpoint(): EndpointPermissionRequirement {
  return { all: [], any: [] };
}

function permissionRequirementForEndpoint(endpoint: EndpointDef): EndpointPermissionRequirement {
  const key = `${endpoint.method} ${endpoint.path}`;
  if (key === "GET /api/admin/status") return requiresAll("admin.status.view");
  if (key === "GET /api/admin/analytics-settings") return requiresAll("admin.analytics.view");
  if (key === "PATCH /api/admin/analytics-settings") return requiresAll("admin.analytics.manage");
  if (endpoint.path === "/api/auth/verify-invite/:code" || endpoint.path === "/api/auth/register/:inviteCode" || endpoint.path === "/api/auth/login") return requiresAll("admin.invite.manage", "admin.users.delete");
  if (endpoint.path.startsWith("/api/admin/invite-links")) {
    return endpoint.method === "GET" ? requiresAll("admin.invite.view") : requiresAll("admin.invite.manage");
  }
  if (endpoint.path.startsWith("/api/admin/audit-log") || endpoint.path.startsWith("/api/admin/audit-archive")) {
    return endpoint.path.includes("export") || endpoint.path.includes("download") ? requiresAll("admin.audit.export") : requiresAll("admin.audit.view");
  }
  if (endpoint.path.startsWith("/api/admin/users")) {
    if (endpoint.path.includes("role")) return requiresAll("admin.users.edit", "admin.users.role", "admin.users.delete");
    if (endpoint.path.includes("deactivate") || endpoint.path.includes("reactivate")) return requiresAll("admin.users.edit", "admin.users.activate", "admin.users.delete");
    if (endpoint.path.includes("delete")) return requiresAll("admin.users.edit", "admin.users.delete");
    if (endpoint.path.includes("reset-password")) return requiresAll("admin.users.edit", "admin.users.password", "admin.users.delete");
    return requiresAll("admin.users.edit", "admin.users.delete");
  }
  if (endpoint.path.startsWith("/api/admin/roles")) {
    return endpoint.method === "GET" ? requiresAny("admin.roles.view", "admin.roles.manage") : requiresAll("admin.roles.manage");
  }
  if (endpoint.path.startsWith("/api/badges")) return requiresAll("admin.badges.manage");
  if (endpoint.path.startsWith("/api/events/templates")) return requiresAll("events.templates");
  if (endpoint.path === "/api/events?fixture=poll" || endpoint.path === "/api/events?fixture=raffle") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events/:id/participants?fixture=raffle") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events/:id/raffle/draw") {
    return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
  }
  if (endpoint.path === "/api/events?fixture=guild-war") return requiresAll("events.create", "events.archive", "events.delete", "guildwar.teams.edit", "guildwar.history.edit");
  if (endpoint.path.startsWith("/api/events")) {
    if (endpoint.method === "POST") {
      return endpoint.path.includes("batch-details") || endpoint.path.includes("/join")
        ? publicEndpoint()
        : requiresAll("events.create", "events.edit", "events.archive", "events.delete");
    }
    if (endpoint.method === "PATCH") return requiresAll("events.create", "events.edit", "events.archive", "events.delete");
    if (endpoint.method === "DELETE") {
      return endpoint.path.includes("participants") || endpoint.path.includes("leave")
        ? requiresAll("events.create", "events.edit", "events.archive", "events.delete")
        : endpoint.path.includes("destroy")
          ? requiresAll("events.delete")
          : requiresAll("events.archive");
    }
  }
  if (endpoint.path.startsWith("/api/announcements")) {
    if (endpoint.method === "POST") return requiresAll("announcements.create", "announcements.edit", "announcements.delete");
    if (endpoint.method === "PATCH") return requiresAll("announcements.create", "announcements.edit", "announcements.delete");
    if (endpoint.method === "DELETE") return endpoint.path.includes("permanent")
      ? requiresAll("announcements.delete")
      : requiresAll("announcements.archive");
  }
  if (endpoint.path.startsWith("/api/gallery")) {
    if (endpoint.path.includes("batch-delete")) return requiresAll("gallery.upload", "gallery.delete");
    if (endpoint.method === "POST" && (endpoint.path.includes("/images") || endpoint.path.includes("/videos"))) return requiresAll("gallery.upload");
    if (endpoint.method === "DELETE") return requiresAll("gallery.upload", "gallery.delete");
  }
  if (endpoint.path.startsWith("/api/guild-war/save-teams") || endpoint.path.startsWith("/api/guild-war/move") || endpoint.path.startsWith("/api/guild-war/role-tag") || endpoint.path.startsWith("/api/guild-war/conclude")) return requiresAll("events.create", "events.archive", "events.delete", "guildwar.teams.edit", "guildwar.history.edit");
  if (endpoint.path.startsWith("/api/guild-war/export")) return requiresAll("guildwar.history.edit");
  if (endpoint.path.startsWith("/api/guild-war/history")) {
    return endpoint.method === "GET" || endpoint.method === "POST" && endpoint.path.includes("/batch")
      ? publicEndpoint()
      : requiresAll("guildwar.history.edit");
  }
  if (endpoint.path.startsWith("/api/wiki/categories")) return endpoint.method === "GET" ? publicEndpoint() : requiresAll("wiki.categories.manage");
  if (endpoint.path.startsWith("/api/wiki/articles")) {
    if (endpoint.method === "POST") return requiresAll("wiki.categories.manage", "wiki.articles.create", "wiki.articles.edit", "wiki.articles.delete");
    if (endpoint.method === "PATCH") return requiresAll("wiki.categories.manage", "wiki.articles.create", "wiki.articles.edit", "wiki.articles.delete");
    if (endpoint.method === "DELETE") return endpoint.path.includes("permanent")
      ? requiresAll("wiki.articles.delete")
      : requiresAll("wiki.articles.archive");
  }
  return publicEndpoint();
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
      endpoint.path.includes("/change-username") ||
      endpoint.path.includes("/media/") ||
      endpoint.path.includes("/profile");
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
    const eventId = endpoint.path.includes("fixture=poll")
      ? context.createdPollEventId
      : endpoint.path.includes("fixture=raffle") || endpoint.path.includes("/raffle/draw")
        ? context.createdRaffleEventId
        : endpoint.path.includes("/poll/vote")
          ? context.createdPollEventId
          : endpoint.path.includes("/destroy") ? context.createdEventId : context.createdEventId ?? context.eventId;
    const next = replacePathParam(path, ":id", eventId);
    if (!next) {
      return { path, missing: endpoint.path.includes("/destroy") ? "created event id" : "event id" };
    }
    path = next.replace("?fixture=poll", "").replace("?fixture=raffle", "");
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
    const announcementId = endpoint.path.includes("/permanent") ? context.createdAnnouncementId : context.createdAnnouncementId ?? context.announcementId;
    const next = replacePathParam(path, ":id", announcementId);
    if (!next) {
      return { path, missing: endpoint.path.includes("/permanent") ? "created announcement id" : "announcement id" };
    }
    path = next;
  }

  if (path.includes("/api/gallery/:id")) {
    let galleryId: string | null;
    if (endpoint.method === "DELETE") {
      galleryId = context.galleryDeleteId ?? context.createdGalleryImageId;
    } else if (endpoint.method === "GET") {
      galleryId = context.galleryItemId ?? context.createdGalleryImageId ?? context.galleryDeleteId;
    } else {
      galleryId = context.createdGalleryImageId ?? context.galleryDeleteId ?? context.galleryItemId;
    }
    const next = replacePathParam(path, ":id", galleryId);
    if (!next) {
      return { path, missing: "gallery item id" };
    }
    path = next;
  }

  if (path.includes("/api/guild-war/history/:id")) {
    const historyId = endpoint.path.includes("/member-stats")
      ? context.createdConcludedWarHistoryId ?? context.createdWarHistoryId ?? context.warHistoryId
      : context.createdWarHistoryId ?? context.createdConcludedWarHistoryId ?? context.warHistoryId;
    const next = replacePathParam(path, ":id", historyId);
    if (!next) {
      return { path, missing: "guild war history id" };
    }
    path = next;
  }

  if (path.includes("/api/guild-war/history/") && path.includes(":userId")) {
    const next = replacePathParam(path, ":userId", context.warMemberUserId ?? context.targetUserId ?? context.meId);
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
    const articleId = endpoint.path.includes("/permanent") ? context.createdWikiArticleId : context.createdWikiArticleId ?? context.wikiArticleId;
    const next = replacePathParam(path, ":id", articleId);
    if (!next) {
      return { path, missing: endpoint.path.includes("/permanent") ? "created wiki article id" : "wiki article id" };
    }
    path = next;
  }

  if (path.includes("/api/auth/verify-invite/:code")) {
    const next = replacePathParam(path, ":code", context.registerInviteCode);
    if (!next) {
      return { path, missing: "invite code (run invite links first)" };
    }
    path = next;
  }

  if (endpoint.path === "/api/users/image") {
    if (!context.userImageKey) {
      return { path, missing: "user image key (run user image upload first)" };
    }
    return { path: `/api/users/image?key=${encodeURIComponent(context.userImageKey)}`, missing: null };
  }

  if (endpoint.path === "/api/events/image") {
    if (!context.eventImageKey) {
      return { path, missing: "event image key (run event image upload first)" };
    }
    return { path: `/api/events/image?key=${encodeURIComponent(context.eventImageKey)}`, missing: null };
  }

  if (endpoint.path === "/api/announcements/image") {
    if (!context.announcementImageKey) {
      return { path, missing: "announcement image key (run announcement image upload first)" };
    }
    return { path: `/api/announcements/image?key=${encodeURIComponent(context.announcementImageKey)}`, missing: null };
  }

  if (endpoint.path === "/api/gallery/image") {
    if (!context.galleryImageKey) {
      return { path, missing: "gallery image key (run gallery image upload first)" };
    }
    return { path: `/api/gallery/image?key=${encodeURIComponent(context.galleryImageKey)}`, missing: null };
  }

  if (endpoint.path === "/api/wiki/image") {
    if (!context.wikiImageKey) {
      return { path, missing: "wiki image key (run wiki image upload first)" };
    }
    return { path: `/api/wiki/image?key=${encodeURIComponent(context.wikiImageKey)}`, missing: null };
  }

  if (path.includes("/api/badges/:id")) {
    const next = replacePathParam(path, ":id", context.badgeId);
    if (!next) {
      return { path, missing: "badge id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/invite-links/:id")) {
    const inviteId = endpoint.method === "DELETE" ? context.createdInviteLinkId ?? context.inviteLinkId : context.inviteLinkId;
    const next = replacePathParam(path, ":id", inviteId);
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
    if (endpoint.path.includes("/change-password") || endpoint.path.includes("/change-username")) {
      return skipEndpoint(endpoint.path, "Requires current user password", true);
    }
    if (endpoint.path === "/api/admin/audit-archive/download") {
      return skipEndpoint(endpoint.path, "No archived audit month is available in this environment", true);
    }
    if (endpoint.path === "/api/admin/audit-archive/download/file") {
      return skipEndpoint(endpoint.path, "No audit archive download token is available in this environment", true);
    }
    return skipEndpoint(endpoint.path, `Missing ${resolved.missing}`);
  }
  const path = resolved.path;

  if (endpoint.method === "DELETE") {
    switch (endpoint.path) {
      case "/api/users/:id/media/avatar":
        return { path };
      case "/api/users/:id/media/audio":
        return { path };
      case "/api/users/:id/media/images":
        if (!context.uploadedImageKey) {
          return skipEndpoint(path, "No test-uploaded image to delete");
        }
        return buildJsonRequest(path, { keys: [context.uploadedImageKey] });
      case "/api/events/:id/participants":
        if (!context.eventParticipantUserId && !context.targetUserId && !context.meId) {
          return skipEndpoint(path, "Missing participant user id");
        }
        return buildJsonRequest(path, {
          user_ids: [context.eventParticipantUserId ?? context.targetUserId ?? context.meId],
        });
      default:
        return { path };
    }
  }

  if (endpoint.method === "GET") {
    return { path };
  }

  const nowId = Date.now();
  switch (`${endpoint.method} ${endpoint.path}`) {
    case "PATCH /api/admin/analytics-settings":
      return buildJsonRequest(path, {
        reference_duration_minutes: 30,
        modifier_weights: { kda: 0.3, towers: 0.1, credits: 0.3, distance: 0.15, basehp: 0.15 },
      });

    case "POST /api/auth/register/:inviteCode":
      {
        const username = `systemtest_${nowId}`;
        context.registeredUsername = username;
        context.registeredUserPassword = "Passw0rd!";
        return {
          ...buildJsonRequest(path, {
            username,
            password: context.registeredUserPassword,
            confirmPassword: context.registeredUserPassword,
          }),
          // Prevent this guest-flow endpoint from replacing the current admin session.
          credentials: "omit",
        };
      }

    case "PATCH /api/users/:id/profile":
      return buildJsonRequest(path, {
        bio: "[systemtest] API test profile update",
        classes: [],
      });

    case "POST /api/users/:id/media/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/users/:id/media/audio":
      return buildFormRequest(path, [["file", createTinyAudioFile()]]);

    case "POST /api/users/:id/change-password":
      return skipEndpoint(path, "Requires current user password", true);

    case "POST /api/users/:id/change-username":
      return skipEndpoint(path, "Requires current user password", true);

    case "POST /api/events":
    case "POST /api/events?fixture=guild-war":
    case "POST /api/events?fixture=poll":
    case "POST /api/events?fixture=raffle":
      return buildJsonRequest(path, {
        type: endpoint.path === "/api/events?fixture=guild-war"
          ? "guild_war"
          : endpoint.path === "/api/events?fixture=poll"
            ? "poll"
            : endpoint.path === "/api/events?fixture=raffle"
              ? "raffle"
              : "weekly_mission",
        title: endpoint.path === "/api/events?fixture=guild-war"
          ? `[systemtest] API Guild War Event ${nowId}`
          : endpoint.path === "/api/events?fixture=poll"
            ? `[systemtest] API Poll Event ${nowId}`
            : endpoint.path === "/api/events?fixture=raffle"
              ? `[systemtest] API Raffle Event ${nowId}`
              : `[systemtest] API Test Event ${nowId}`,
        description: "[systemtest] Created by admin API tester",
        start_at: toIso(2),
        end_at: toIso(3),
        ...(endpoint.path === "/api/events?fixture=poll"
          ? { poll: { options: ["[systemtest] Option A", "[systemtest] Option B"], results_visibility: "always", show_voter_names: false } }
          : endpoint.path === "/api/events?fixture=raffle"
            ? { capacity: 20, winner_count: 1 }
            : { capacity: 20 }),
      });

    case "PATCH /api/events/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Updated Event ${nowId}`,
      });

    case "POST /api/events/:id/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/events/:id/participants":
    case "POST /api/events/:id/participants?fixture=raffle":
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing participant user id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.targetUserId ?? context.meId],
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
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        caption: "[systemtest] API test video",
      });

    case "POST /api/guild-war/save-teams":
      if (!context.createdGuildWarEventId && !context.createdEventId && !context.eventId && !context.warEventId) {
        return skipEndpoint(path, "Missing event id for guild war teams");
      }
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing user id for guild war teams");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId ?? context.eventId ?? context.warEventId,
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
        pool_members: context.meId && context.meId !== context.targetUserId
          ? [{ user_id: context.meId }]
          : [],
      });

    case "POST /api/guild-war/move":
      if (!context.createdGuildWarEventId && !context.createdEventId && !context.eventId && !context.warEventId) {
        return skipEndpoint(path, "Missing event id for guild war move");
      }
      if (!context.warMemberUserId && !context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing member user id for guild war move");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId ?? context.eventId ?? context.warEventId,
        moves: [{ user_id: context.meId && context.meId !== context.warMemberUserId ? context.meId : context.warMemberUserId ?? context.targetUserId ?? context.meId, to: "pool" }],
      });

    case "POST /api/guild-war/conclude":
      if (!context.createdGuildWarEventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing created event id for guild war conclude");
      }
      if (!context.warMemberUserId && !context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing member user id for guild war conclude");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId,
        war_info: {
          enemy_name: "[systemtest] API Enemy",
          result: "win",
          duration_minutes: 30,
          own_stats: { kills: 10, towers: 3, credits: 10000, distance: 3000, base_hp: 50 },
          enemy_stats: { kills: 5, towers: 1, credits: 8000, distance: 2000, base_hp: 0 },
        },
        member_stats: [
          {
            user_id: context.warMemberUserId ?? context.targetUserId ?? context.meId,
            stats: { kills: 1 },
          },
        ],
      });

    case "PATCH /api/guild-war/role-tag":
      if (!context.createdGuildWarEventId && !context.createdEventId && !context.eventId && !context.warEventId) {
        return skipEndpoint(path, "Missing event id for role tag");
      }
      if (!context.warMemberUserId && !context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing active war member user id for role tag");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId ?? context.eventId ?? context.warEventId,
        updates: [{ user_id: context.warMemberUserId ?? context.targetUserId ?? context.meId, role_tag: "DPS" }],
      });

    case "POST /api/guild-war/history":
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId ?? context.eventId ?? context.warEventId ?? undefined,
        war_name: `[systemtest] API Test War ${nowId}`,
        result: "win",
      });

    case "PATCH /api/guild-war/history/:id":
      return buildJsonRequest(path, {
        notes: "[systemtest] API test history update",
      });

    case "PATCH /api/guild-war/history/:id/member-stats/:userId":
      if (!context.createdConcludedWarHistoryId) {
        return skipEndpoint(path, "Missing concluded war history id for member stats update");
      }
      if (!context.warMemberUserId && !context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing war member user id for member stats update");
      }
      return buildJsonRequest(path, {
        stats: { kills: 1 },
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

    case "POST /api/auth/login":
      {
        const username = context.adminCreatedUsername ?? context.registeredUsername;
        const password = context.adminCreatedUserPassword ?? context.registeredUserPassword;
        if (!username || !password) {
          return skipEndpoint(path, "Requires test user credentials");
        }
        return {
          ...buildJsonRequest(path, {
            username,
            password,
          }),
          credentials: "omit",
        };
      }

    case "POST /api/auth/logout":
      return skipEndpoint(path, "Logout is tested by dedicated auth flows; browser smoke run preserves the active admin session", true);

    case "POST /api/users/:id/media/avatar":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/events/batch-details":
      if (!context.createdEventId && !context.eventId) {
        return skipEndpoint(path, "Missing event id");
      }
      return buildJsonRequest(path, {
        ids: [context.createdEventId ?? context.eventId],
      });

    case "POST /api/events/:id/poll/vote":
      if (!context.pollOptionId) {
        return skipEndpoint(path, "Missing poll option id");
      }
      return buildJsonRequest(path, {
        option_ids: [context.pollOptionId],
      });

    case "POST /api/events/:id/raffle/draw":
      return buildJsonRequest(path, {});

    case "POST /api/gallery/batch-delete":
      if (!context.galleryDeleteId) {
        return skipEndpoint(path, "Missing gallery item to batch-delete");
      }
      return buildJsonRequest(path, {
        ids: [context.galleryDeleteId],
      });

    case "POST /api/guild-war/history/batch":
      if (!context.createdWarHistoryId && !context.warHistoryId) {
        return skipEndpoint(path, "Missing war history id");
      }
      return buildJsonRequest(path, {
        ids: [context.createdWarHistoryId ?? context.warHistoryId],
      });

    case "POST /api/guild-war/history/batch-delete":
      {
        const ids = [context.createdConcludedWarHistoryId]
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (ids.length === 0) {
          return skipEndpoint(path, "Missing concluded war history id for batch delete");
        }
        return buildJsonRequest(path, { ids });
      }

    case "PATCH /api/guild-war/history/:id/member-stats/batch":
      if (!context.createdConcludedWarHistoryId || (!context.warMemberUserId && !context.targetUserId && !context.meId)) {
        return skipEndpoint(path, "Missing war history id or member user id");
      }
      return buildJsonRequest(path, {
        updates: [{ user_id: context.warMemberUserId ?? context.targetUserId ?? context.meId, stats: { stats: { kills: 2 } } }],
      });

    case "POST /api/badges":
      return buildJsonRequest(path, {
        name: `[systemtest] API Badge ${nowId}`,
        label_html: `<span>[systemtest] API Badge ${nowId}</span>`,
        description: "[systemtest] Created by API tester",
        color: "#f59e0b",
      });

    case "PATCH /api/badges/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Badge Updated ${nowId}`,
      });

    case "POST /api/badges/:id/assign":
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing user id for badge assign");
      }
      return buildJsonRequest(path, {
        user_ids: [context.targetUserId ?? context.meId],
      });

    case "POST /api/badges/:id/unassign":
      if (!context.targetUserId && !context.meId) {
        return skipEndpoint(path, "Missing user id for badge unassign");
      }
      return buildJsonRequest(path, {
        user_ids: [context.targetUserId ?? context.meId],
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
  const isSuccess = result.status !== null && result.status >= 200 && result.status < 300;

  // Clear created*Id when in-category DELETEs succeed so cleanup won't 404
  if (isSuccess && endpoint.method === "DELETE") {
    const next: TestRunContext = { ...previous };
    if (endpoint.path === "/api/wiki/categories/:id" && next.createdWikiCategoryId === next.wikiCategoryId) {
      next.createdWikiCategoryId = null;
    }
    if (endpoint.path === "/api/guild-war/history/:id" && next.createdWarHistoryId === next.warHistoryId) {
      next.createdWarHistoryId = null;
    }
    if (endpoint.path === "/api/guild-war/history/:id" && next.createdSaveTeamsHistoryId === next.warHistoryId) {
      next.createdSaveTeamsHistoryId = null;
    }
    if (endpoint.path === "/api/guild-war/history/:id" && next.createdConcludedWarHistoryId === next.warHistoryId) {
      next.createdConcludedWarHistoryId = null;
    }
    if (endpoint.path === "/api/events/templates/:id" && next.createdTemplateId === next.eventTemplateId) {
      next.createdTemplateId = null;
    }
    if (endpoint.path === "/api/events/:id/destroy" && next.createdEventId) {
      next.createdEventId = null;
      next.eventImageKey = null;
    }
    if (endpoint.path === "/api/announcements/:id/permanent" && next.createdAnnouncementId) {
      next.createdAnnouncementId = null;
      next.announcementImageKey = null;
    }
    if (endpoint.path === "/api/wiki/articles/:id/permanent" && next.createdWikiArticleId) {
      next.createdWikiArticleId = null;
      next.wikiImageKey = null;
    }
    if (endpoint.path === "/api/gallery/:id") {
      const deletedId = next.galleryDeleteId ?? next.createdGalleryImageId;
      if (deletedId && deletedId === next.createdGalleryVideoId) {
        next.createdGalleryVideoId = null;
      }
      if (deletedId && deletedId === next.createdGalleryImageId) {
        next.createdGalleryImageId = null;
        next.galleryImageKey = null;
      }
    }
    if (endpoint.path === "/api/badges/:id" && next.createdBadgeId === next.badgeId) {
      next.createdBadgeId = null;
    }
    if (endpoint.path === "/api/admin/invite-links/:id" && next.createdInviteLinkId === next.inviteLinkId) {
      next.createdInviteLinkId = null;
    }
    if (endpoint.path === "/api/admin/invite-links/:id/permanent" && next.createdInviteLinkId === next.inviteLinkId) {
      next.createdInviteLinkId = null;
    }
    if (endpoint.path === "/api/admin/roles/:id" && next.createdRoleId === next.adminRoleId) {
      next.createdRoleId = null;
    }
    if (endpoint.path === "/api/admin/users/batch/delete") {
      next.adminCreatedUserId = null;
      next.adminCreatedUsername = null;
      next.adminCreatedUserPassword = null;
    }
    if (endpoint.path === "/api/users/:id/media/images") {
      next.uploadedImageKey = null;
    }
    return next;
  }

  if (!isSuccess || result.parsedJson === null) {
    return previous;
  }

  const next: TestRunContext = { ...previous };
  const payload = result.parsedJson as Record<string, unknown>;

  if (endpoint.path === "/api/guild-war/history/batch-delete") {
    if (next.warHistoryId === next.createdConcludedWarHistoryId) {
      next.warHistoryId = next.createdWarHistoryId;
    }
    next.createdConcludedWarHistoryId = null;
    return next;
  }

  if (endpoint.path === "/api/auth/me") {
    const user = isRecord(payload.user) ? payload.user : null;
    const profile = isRecord(payload.profile) ? payload.profile : null;
    next.meId = readString(user?.id) ?? next.meId;
    next.meUsername = readString(user?.username) ?? next.meUsername;
    const profileImages = Array.isArray(profile?.images) ? profile.images : [];
    const firstImage = profileImages.find((item): item is string => typeof item === "string");
    const profileImageKey = firstImage ?? null;
    next.userImageKey = isProfileMediaKey(profileImageKey) ? profileImageKey : next.userImageKey;
    next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    if (profile && !next.targetProfileSnapshot) {
      const bio = typeof profile.bio === "string" ? profile.bio : null;
      const classes = Array.isArray(profile.classes) ? profile.classes.filter((c): c is string => typeof c === "string") : [];
      next.targetProfileSnapshot = { bio, classes };
    }
    return next;
  }

  if (endpoint.path === "/api/auth/register/:inviteCode") {
    const userId = readString(payload.user_id) ?? readString((isRecord(payload.user) ? payload.user : null)?.id);
    next.registeredUserId = userId ?? next.registeredUserId;
    if (userId && userId !== next.meId) {
      next.targetUserId = next.targetUserId ?? userId;
    }
    next.registeredUsername = readString((isRecord(payload.user) ? payload.user : null)?.username) ?? next.registeredUsername;
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
      const profileImageKey = firstImage ?? null;
      next.userImageKey = isProfileMediaKey(profileImageKey) ? profileImageKey : next.userImageKey;
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
    const profileImageKey = firstImage ?? null;
    next.userImageKey = isProfileMediaKey(profileImageKey) ? profileImageKey : next.userImageKey;
    next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    return next;
  }

  if (endpoint.path === "/api/users/:id/media/images") {
    const firstKey = Array.isArray(payload.keys)
      ? payload.keys.find((item): item is string => typeof item === "string")
      : null;
    if (firstKey && endpoint.method === "POST") {
      next.uploadedImageKey = firstKey;
    }
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

  if (
    endpoint.path === "/api/events" ||
    endpoint.path === "/api/events?fixture=guild-war" ||
    endpoint.path === "/api/events?fixture=poll" ||
    endpoint.path === "/api/events?fixture=raffle"
  ) {
    const id = readString(payload.id);
    if (endpoint.path === "/api/events?fixture=guild-war") {
      next.createdGuildWarEventId = id ?? next.createdGuildWarEventId;
      next.warEventId = id ?? next.warEventId;
    } else if (endpoint.path === "/api/events?fixture=poll") {
      next.createdPollEventId = id ?? next.createdPollEventId;
    } else if (endpoint.path === "/api/events?fixture=raffle") {
      next.createdRaffleEventId = id ?? next.createdRaffleEventId;
    } else {
      next.createdEventId = id ?? next.createdEventId;
    }
    return next;
  }

  if (endpoint.path === "/api/events/:id?fixture=poll") {
    const poll = isRecord(payload.poll) ? payload.poll : null;
    const options = Array.isArray(poll?.options) ? poll.options : [];
    const firstOption = options.find((item): item is Record<string, unknown> => isRecord(item));
    next.pollOptionId = readString(firstOption?.id) ?? next.pollOptionId;
    return next;
  }

  if (endpoint.path === "/api/events/:id/images") {
    const firstKey = Array.isArray(payload.keys)
      ? payload.keys.find((item): item is string => typeof item === "string")
      : null;
    next.eventImageKey = firstKey ?? next.eventImageKey;
    return next;
  }

  if (endpoint.path === "/api/events/templates/list") {
    const firstTemplate = firstArrayItem(payload.data);
    next.eventTemplateId = readString(firstTemplate?.id) ?? next.eventTemplateId;
    return next;
  }

  if (endpoint.path === "/api/events/templates") {
    const id = readString(payload.id);
    next.eventTemplateId = id ?? next.eventTemplateId;
    next.createdTemplateId = id ?? next.createdTemplateId;
    return next;
  }

  if (endpoint.path === "/api/events/:id/participants" && endpoint.method === "POST") {
    const firstParticipant = firstArrayItem(payload.data);
    next.eventParticipantUserId = readString(firstParticipant?.user_id) ?? next.eventParticipantUserId;
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

  if (endpoint.path === "/api/announcements/:id/images") {
    const firstKey = Array.isArray(payload.keys)
      ? payload.keys.find((item): item is string => typeof item === "string")
      : null;
    next.announcementImageKey = firstKey ?? next.announcementImageKey;
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
    next.galleryImageKey = readString(firstItem?.url) ?? next.galleryImageKey;
    return next;
  }

  if (endpoint.path === "/api/gallery/videos") {
    const id = readString(payload.id);
    next.galleryDeleteId = id ?? next.galleryDeleteId;
    next.createdGalleryVideoId = id ?? next.createdGalleryVideoId;
    return next;
  }

  if (endpoint.path === "/api/gallery/batch-delete") {
    next.galleryDeleteId = null;
    next.createdGalleryVideoId = null;
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

  if (endpoint.path === "/api/guild-war/save-teams") {
    next.warMemberUserId = next.targetUserId ?? next.meId ?? next.warMemberUserId;
    return next;
  }

  if (endpoint.path === "/api/guild-war/conclude") {
    const id = readString(payload.war_history_id);
    next.warHistoryId = id ?? next.warHistoryId;
    next.createdConcludedWarHistoryId = id ?? next.createdConcludedWarHistoryId;
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

  if (endpoint.path === "/api/wiki/articles/:id/images") {
    const firstKey = Array.isArray(payload.keys)
      ? payload.keys.find((item): item is string => typeof item === "string")
      : null;
    next.wikiImageKey = firstKey ?? next.wikiImageKey;
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
    next.adminCreatedUsername = readString(payload.username) ?? next.adminCreatedUsername;
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

  if (endpoint.path === "/api/badges") {
    if (Array.isArray(payload.data)) {
      const first = firstArrayItem(payload.data);
      next.badgeId = readString(first?.id) ?? next.badgeId;
    } else if (Array.isArray(payload)) {
      const first = payload.find((item): item is Record<string, unknown> => isRecord(item));
      next.badgeId = readString(first?.id) ?? next.badgeId;
    } else {
      const id = readString(payload.id);
      next.badgeId = id ?? next.badgeId;
      if (endpoint.method === "POST") {
        next.createdBadgeId = id ?? next.createdBadgeId;
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
      error: prepared.optionalSkip ? null : "Skipped",
      ranAt,
      parsedJson: null,
      skipped: true,
    };
  }

  const started = performance.now();
  try {
    const mergedHeaders: Record<string, string> = { ...prepared.headers };
    if (endpoint.method === "POST" || endpoint.method === "PATCH" || endpoint.method === "DELETE") {
      mergedHeaders["X-Requested-With"] = "XMLHttpRequest";
    }

    const response = await fetch(prepared.path, {
      method: endpoint.method,
      credentials: prepared.credentials ?? "include",
      signal,
      headers: mergedHeaders,
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
