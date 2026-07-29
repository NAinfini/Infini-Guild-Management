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
  /** Server-issued UID; every request and cleanup operation is bound to it. */
  runId: string | null;
  /** Independent public fixture label; never grants access to the cleanup run. */
  fixtureId: string | null;
  meId: string | null;
  meUsername: string | null;
  registerInviteCode: string | null;
  userImageKey: string | null;
  userAudioKey: string | null;
  eventId: string | null;
  eventParticipantUserId: string | null;
  pollOptionId: string | null;
  eventTemplateId: string | null;
  announcementId: string | null;
  announcementStagingToken: string | null;
  galleryItemId: string | null;
  galleryDeleteId: string | null;
  warEventId: string | null;
  warHistoryId: string | null;
  warTeamId: string | null;
  warMemberUserId: string | null;
  createdConcludedWarHistoryId: string | null;
  /** Captured from GET /api/game-data so the rotations endpoint has a real class. */
  gameDataClassId: string | null;
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
  createdGuildWarEventId: string | null;
  createdRoleId: string | null;
  createdBadgeId: string | null;
  createdEventId: string | null;
  createdPollEventId: string | null;
  createdRaffleEventId: string | null;
  createdTemplateId: string | null;
  storageId: string | null;
  storageCategoryId: string | null;
  storageItemId: string | null;
  storageImageKey: string | null;
  createdStorageId: string | null;
  createdStorageCategoryId: string | null;
  createdStorageItemId: string | null;
  createdStorageImageId: string | null;
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

export function createInitialTestRunContext(): TestRunContext {
  return {
    runId: null,
    fixtureId: null,
    meId: null,
    meUsername: null,
    registerInviteCode: null,
    userImageKey: null,
    userAudioKey: null,
    eventId: null,
    eventParticipantUserId: null,
    pollOptionId: null,
    eventTemplateId: null,
    announcementId: null,
    announcementStagingToken: null,
    galleryItemId: null,
    galleryDeleteId: null,
    warEventId: null,
    warHistoryId: null,
    warTeamId: null,
    warMemberUserId: null,
    createdConcludedWarHistoryId: null,
    gameDataClassId: null,
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
    createdGuildWarEventId: null,
    createdRoleId: null,
    createdBadgeId: null,
    createdEventId: null,
    createdPollEventId: null,
    createdRaffleEventId: null,
    createdTemplateId: null,
    storageId: null,
    storageCategoryId: null,
    storageItemId: null,
    storageImageKey: null,
    createdStorageId: null,
    createdStorageCategoryId: null,
    createdStorageItemId: null,
    createdStorageImageId: null,
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

export function disposableMemberId(context: TestRunContext): string | null {
  return context.adminCreatedUserId ?? context.registeredUserId;
}
