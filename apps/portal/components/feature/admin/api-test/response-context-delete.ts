import {
  type EndpointDef,
  type EndpointResult,
  type TestRunContext,
  isRecord,
  readString,
} from "./types";

export function clearContextForDelete(
  previous: TestRunContext,
  endpoint: EndpointDef,
  result: EndpointResult,
): TestRunContext {
  const next: TestRunContext = { ...previous };
  const payload = isRecord(result.parsedJson) ? result.parsedJson : null;
  if (endpoint.path === "/api/wiki/categories/:id" && next.createdWikiCategoryId === next.wikiCategoryId) {
    next.createdWikiCategoryId = null;
  }
  if (endpoint.path === "/api/guild-war/history/:id" && next.createdWarHistoryId === next.warHistoryId) {
    next.createdWarHistoryId = null;
  }
  if (endpoint.path === "/api/guild-war/history/:id" && next.createdConcludedWarHistoryId === next.warHistoryId) {
    next.createdConcludedWarHistoryId = null;
  }
  if (endpoint.path === "/api/events/templates/:id" && next.createdTemplateId === next.eventTemplateId) {
    next.createdTemplateId = null;
  }
  if (endpoint.path === "/api/events/:id/destroy" && next.createdEventId) {
    next.createdEventId = null;
    next.eventImageMediaId = null;
  }
  if (endpoint.path === "/api/announcements/:id/permanent" && next.createdAnnouncementId) {
    next.createdAnnouncementId = null;
    next.announcementImageMediaId = null;
    next.announcementEtag = null;
  }
  if (endpoint.path === "/api/wiki/articles/:id/permanent" && next.createdWikiArticleId) {
    next.createdWikiArticleId = null;
    next.wikiImageMediaId = null;
    next.wikiArticleEtag = null;
  }
  if (endpoint.path === "/api/gallery/:id") {
    const deletedId = next.galleryDeleteId ?? next.createdGalleryImageId;
    if (deletedId && deletedId === next.createdGalleryVideoId) next.createdGalleryVideoId = null;
    if (deletedId && deletedId === next.createdGalleryImageId) {
      next.createdGalleryImageId = null;
      next.galleryImageMediaId = null;
      next.galleryItemEtag = null;
    }
  }
  if (endpoint.path === "/api/badges/:id" && next.createdBadgeId === next.badgeId) {
    next.createdBadgeId = null;
    next.createdBadgeUpdatedAt = null;
  }
  if (endpoint.path === "/api/admin/invite-links/:id/permanent" && next.createdInviteLinkId === next.inviteLinkId) {
    next.createdInviteLinkId = null;
  }
  if (endpoint.path === "/api/admin/roles/:id" && next.createdRoleId === next.adminRoleId) {
    next.createdRoleId = null;
    next.adminRoleRevisionToken = null;
  }
  if (endpoint.path === "/api/admin/users/batch/delete") {
    next.adminCreatedUserId = null;
    next.adminCreatedLoginName = null;
    next.adminCreatedUserPassword = null;
  }
  if (endpoint.path === "/api/users/:id/media/images") next.uploadedImageMediaId = null;
  if (endpoint.path === "/api/storage/items/:id" && next.createdStorageItemId === next.storageItemId) {
    next.createdStorageItemId = null;
    next.storageItemId = null;
    next.storageItemUpdatedAt = null;
    next.storageImageMediaId = null;
  }
  if (endpoint.path === "/api/storage/items/:id/images/:imageId") {
    next.storageImageMediaId = null;
    next.storageItemUpdatedAt = readString(payload?.updated_at) ?? next.storageItemUpdatedAt;
  }
  if (endpoint.path === "/api/storage/storages/:storageId/categories/:id" && next.createdStorageCategoryId === next.storageCategoryId) {
    next.createdStorageCategoryId = null;
    next.storageCategoryId = null;
    next.storageCategoryName = null;
    next.storageStructureRevision = typeof payload?.structure_revision === "number"
      ? payload.structure_revision
      : next.storageStructureRevision;
  }
  if (endpoint.path === "/api/storage/storages/:id" && next.createdStorageId === next.storageId) {
    next.createdStorageId = null;
    next.storageId = null;
    next.storageName = null;
    next.storageDescription = null;
    next.storageStructureRevision = null;
  }
  if (endpoint.path === "/api/classes/:id/icon") {
    next.createdClassIconMediaId = null;
    next.createdClassUpdatedAt = readString(payload?.updated_at) ?? next.createdClassUpdatedAt;
  }
  if (endpoint.path === "/api/classes/:id") {
    next.createdClassId = null;
    next.createdClassUpdatedAt = null;
    next.createdClassIconMediaId = null;
  }
  if (endpoint.path === "/api/class-tags/:id") {
    next.createdClassTagId = null;
    next.createdClassTagUpdatedAt = null;
    next.createdClassTagUsageCount = null;
  }
  if (endpoint.path === "/api/users/:id/absences/:absenceId") next.createdAbsenceId = null;
  return next;
}
