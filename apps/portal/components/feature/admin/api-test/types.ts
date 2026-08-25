export type EndpointDef = {
  /** Display label */
  label: string;
  /** HTTP method */
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** URL path (may include query params) */
  path: string;
  /** Context field used by the canonical media read route. */
  mediaIdContext?: MediaIdContextKey;
  mediaVariant?: "view" | "full";
};

export type MediaIdContextKey =
  | "userImageMediaId"
  | "eventImageMediaId"
  | "announcementImageMediaId"
  | "galleryImageMediaId"
  | "wikiImageMediaId"
  | "storageImageMediaId"
  | "createdClassIconMediaId"
  | "siteLogoMediaId";

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
  meDisplayName: string | null;
  meRoleLevel: number | null;
  mePermissions: Record<string, boolean> | null;
  registerInviteCode: string | null;
  userImageMediaId: string | null;
  userAudioMediaId: string | null;
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
  adminCreatedLoginName: string | null;
  adminCreatedUserPassword: string | null;
  adminRoleId: string | null;
  auditArchiveMonth: string | null;
  auditArchiveDownloadToken: string | null;
  badgeId: string | null;
  eventImageMediaId: string | null;
  announcementImageMediaId: string | null;
  galleryImageMediaId: string | null;
  wikiImageMediaId: string | null;
  siteLogoMediaId: string | null;
  /** Media ID created by the test and safe to delete during cleanup. */
  uploadedImageMediaId: string | null;
  registeredUserId: string | null;
  registeredLoginName: string | null;
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
  createdClassId: string | null;
  createdClassIconMediaId: string | null;
  createdClassTagId: string | null;
  createdAbsenceId: string | null;
  createdEventId: string | null;
  createdPollEventId: string | null;
  createdRaffleEventId: string | null;
  createdTemplateId: string | null;
  storageId: string | null;
  storageCategoryId: string | null;
  storageItemId: string | null;
  storageImageMediaId: string | null;
  createdStorageId: string | null;
  createdStorageCategoryId: string | null;
  createdStorageItemId: string | null;
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
    meDisplayName: null,
    meRoleLevel: null,
    mePermissions: null,
    registerInviteCode: null,
    userImageMediaId: null,
    userAudioMediaId: null,
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
    adminCreatedLoginName: null,
    adminCreatedUserPassword: null,
    adminRoleId: null,
    auditArchiveMonth: null,
    auditArchiveDownloadToken: null,
    badgeId: null,
    eventImageMediaId: null,
    announcementImageMediaId: null,
    galleryImageMediaId: null,
    wikiImageMediaId: null,
    siteLogoMediaId: null,
    uploadedImageMediaId: null,
    registeredUserId: null,
    registeredLoginName: null,
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
    createdClassId: null,
    createdClassIconMediaId: null,
    createdClassTagId: null,
    createdAbsenceId: null,
    createdEventId: null,
    createdPollEventId: null,
    createdRaffleEventId: null,
    createdTemplateId: null,
    storageId: null,
    storageCategoryId: null,
    storageItemId: null,
    storageImageMediaId: null,
    createdStorageId: null,
    createdStorageCategoryId: null,
    createdStorageItemId: null,
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

export function disposableMemberId(context: TestRunContext): string | null {
  return context.adminCreatedUserId ?? context.registeredUserId;
}
