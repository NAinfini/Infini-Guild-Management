import { announcementEtag, galleryItemEtag as makeGalleryItemEtag, wikiArticleEtag } from "@guild/shared";
import {
  type EndpointDef,
  type EndpointResult,
  type TestRunContext,
  disposableMemberId,
  firstArrayItem,
  isRecord,
  readString,
} from "./types";
import { clearContextForDelete } from "./response-context-delete";
import { captureStorageResponseContext } from "./response-context-storage";

function firstMediaId(payload: Record<string, unknown>): string | null {
  return Array.isArray(payload.media_ids)
    ? payload.media_ids.find((item): item is string => typeof item === "string") ?? null
    : null;
}

export function captureContextFromResponse(
  previous: TestRunContext,
  endpoint: EndpointDef,
  result: EndpointResult,
): TestRunContext {
  const isSuccess = result.status !== null && result.status >= 200 && result.status < 300;

  // Clear created*Id when in-category DELETEs succeed so cleanup won't 404
  if (isSuccess && endpoint.method === "DELETE") {
    return clearContextForDelete(previous, endpoint, result);
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
    next.meDisplayName = readString(user?.display_name) ?? next.meDisplayName;
    next.meRoleLevel = typeof user?.role_level === "number" ? user.role_level : next.meRoleLevel;
    if (isRecord(user?.permissions)) {
      next.mePermissions = Object.fromEntries(
        Object.entries(user.permissions).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
      );
    }
    const profileImages = Array.isArray(profile?.images) ? profile.images : [];
    const firstImage = profileImages.find((item): item is string => typeof item === "string");
    next.userImageMediaId = firstImage ?? next.userImageMediaId;
    next.userAudioMediaId = readString(profile?.audio_media_id) ?? next.userAudioMediaId;
    return next;
  }

  if (endpoint.path === "/api/classes") {
    if (!Array.isArray(result.parsedJson)) {
      next.createdClassId = readString(payload.id) ?? next.createdClassId;
      next.createdClassUpdatedAt = readString(payload.updated_at) ?? next.createdClassUpdatedAt;
    }
    return next;
  }

  if (endpoint.path === "/api/class-tags") {
    if (!Array.isArray(result.parsedJson) && endpoint.method === "POST") {
      next.createdClassTagId = readString(payload.id) ?? next.createdClassTagId;
      next.createdClassTagUpdatedAt = readString(payload.updated_at) ?? next.createdClassTagUpdatedAt;
      next.createdClassTagUsageCount = typeof payload.usage_count === "number"
        ? payload.usage_count
        : next.createdClassTagUsageCount;
    }
    return next;
  }

  if (endpoint.path === "/api/classes/:id/icon") {
    next.createdClassIconMediaId = readString(payload.icon_media_id) ?? next.createdClassIconMediaId;
    next.createdClassUpdatedAt = readString(payload.updated_at) ?? next.createdClassUpdatedAt;
    return next;
  }

  if (endpoint.path === "/api/classes/:id") {
    next.createdClassUpdatedAt = readString(payload.updated_at) ?? next.createdClassUpdatedAt;
    return next;
  }

  if (endpoint.path === "/api/class-tags/:id") {
    next.createdClassTagUpdatedAt = readString(payload.updated_at) ?? next.createdClassTagUpdatedAt;
    next.createdClassTagUsageCount = typeof payload.usage_count === "number"
      ? payload.usage_count
      : next.createdClassTagUsageCount;
    return next;
  }

  if (endpoint.path === "/api/users/:id/absences" && endpoint.method === "POST") {
    next.createdAbsenceId = readString(payload.id) ?? next.createdAbsenceId;
    return next;
  }

  if (endpoint.path === "/api/auth/register/:inviteCode") {
    const userId = readString(payload.user_id) ?? readString((isRecord(payload.user) ? payload.user : null)?.id);
    next.registeredUserId = userId ?? next.registeredUserId;
    next.registerInviteCode = null;
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
      const profile = isRecord(first.profile) ? first.profile : null;
      const images = Array.isArray(profile?.images) ? profile.images : [];
      const firstImage = images.find((item): item is string => typeof item === "string");
      next.userImageMediaId = firstImage ?? next.userImageMediaId;
      next.userAudioMediaId = readString(profile?.audio_media_id) ?? next.userAudioMediaId;
    }
    return next;
  }

  if (endpoint.path === "/api/users/:id") {
    const profile = isRecord(payload.profile) ? payload.profile : null;
    const images = Array.isArray(profile?.images) ? profile.images : [];
    const firstImage = images.find((item): item is string => typeof item === "string");
    next.userImageMediaId = firstImage ?? next.userImageMediaId;
    next.userAudioMediaId = readString(profile?.audio_media_id) ?? next.userAudioMediaId;
    return next;
  }

  if (endpoint.path === "/api/users/:id/media/images") {
    const mediaId = firstMediaId(payload);
    if (mediaId && endpoint.method === "POST") {
      next.uploadedImageMediaId = mediaId;
    }
    next.userImageMediaId = mediaId ?? next.userImageMediaId;
    return next;
  }

  if (endpoint.path === "/api/users/:id/media/audio") {
    next.userAudioMediaId = readString(payload.media_id) ?? next.userAudioMediaId;
    return next;
  }

  if (endpoint.path === "/api/events?page=1&limit=5") {
    const firstEvent = firstArrayItem(payload.data);
    next.eventId = readString(firstEvent?.id) ?? next.eventId;
    return next;
  }

  if (endpoint.path === "/api/events/:id") {
    next.eventUpdatedAt = readString(payload.updated_at) ?? next.eventUpdatedAt;
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
      next.eventUpdatedAt = readString(payload.updated_at) ?? next.eventUpdatedAt;
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
    next.eventImageMediaId = firstMediaId(payload) ?? next.eventImageMediaId;
    next.eventUpdatedAt = readString(payload.updated_at) ?? next.eventUpdatedAt;
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
    next.eventTemplateUpdatedAt = readString(payload.updated_at) ?? next.eventTemplateUpdatedAt;
    return next;
  }

  if (endpoint.path === "/api/events/templates/:id") {
    next.eventTemplateUpdatedAt = readString(payload.updated_at) ?? next.eventTemplateUpdatedAt;
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
    next.announcementEtag = announcementRecordEtag(payload) ?? result.etag ?? next.announcementEtag;
    return next;
  }

  if (endpoint.path === "/api/announcements/images") {
    next.announcementImageMediaId = firstMediaId(payload) ?? next.announcementImageMediaId;
    return next;
  }

  if (endpoint.path.startsWith("/api/announcements/:id")) {
    next.announcementEtag = announcementRecordEtag(payload) ?? result.etag ?? next.announcementEtag;
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
    next.galleryImageMediaId = readString(firstItem?.media_id) ?? next.galleryImageMediaId;
    next.galleryItemEtag = galleryRecordEtag(firstItem) ?? next.galleryItemEtag;
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
        /*
         * The live board's first member is a real guild member, and
         * warMemberUserId is the target of the move / role-tag / conclude
         * mutations below. Those may only ever act on the disposable test
         * member, so this response is never allowed to seed it. Staying null
         * until a disposable member exists makes those endpoints skip, which
         * is the safe outcome.
         */
        next.warMemberUserId = disposableMemberId(next) ?? next.warMemberUserId;
      }
    }
    return next;
  }

  if (endpoint.path === "/api/guild-war/save-teams") {
    next.warMemberUserId = disposableMemberId(next) ?? next.warMemberUserId;
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

  if (endpoint.path.startsWith("/api/wiki/categories")) {
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const firstCategory = categories.find((item): item is Record<string, unknown> => isRecord(item));
    next.wikiCategoryId = readString(firstCategory?.id) ?? next.wikiCategoryId;
    next.wikiCategoryRevisionToken = readString(payload.revision_token) ?? next.wikiCategoryRevisionToken;
    const id = readString(payload.id);
    next.wikiCategoryId = id ?? next.wikiCategoryId;
    if (endpoint.method === "POST") {
      next.createdWikiCategoryId = id ?? next.createdWikiCategoryId;
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
    next.wikiArticleEtag = wikiRecordEtag(payload) ?? result.etag ?? next.wikiArticleEtag;
    return next;
  }

  if (endpoint.path === "/api/wiki/articles/:id/images") {
    next.wikiImageMediaId = firstMediaId(payload) ?? next.wikiImageMediaId;
    return next;
  }

  if (endpoint.path.startsWith("/api/wiki/articles/")) {
    next.wikiArticleEtag = wikiRecordEtag(payload) ?? result.etag ?? next.wikiArticleEtag;
    return next;
  }

  if (endpoint.path === "/api/admin/invite-links") {
    if (endpoint.method === "POST") {
      const id = readString(payload.id);
      next.inviteLinkId = id ?? next.inviteLinkId;
      next.createdInviteLinkId = id ?? next.createdInviteLinkId;
      next.registerInviteCode = readString(payload.code) ?? next.registerInviteCode;
    }
    return next;
  }

  if (endpoint.path === "/api/admin/users") {
    next.adminCreatedUserId = readString(payload.user_id) ?? next.adminCreatedUserId;
    next.adminCreatedLoginName = readString(payload.temporary_login_name) ?? next.adminCreatedLoginName;
    next.adminCreatedUserPassword = readString(payload.temporary_password) ?? next.adminCreatedUserPassword;
    return next;
  }

  if (endpoint.path === "/api/admin/roles") {
    if (Array.isArray(payload)) {
      const assignableRole = payload
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .filter((role) => {
          if (typeof role.level !== "number" || role.level >= (next.meRoleLevel ?? 0) || !isRecord(role.permissions)) {
            return false;
          }
          return Object.entries(role.permissions).every(
            ([permission, granted]) => granted !== true || next.mePermissions?.[permission] === true,
          );
        })
        .sort((left, right) => Number(right.level) - Number(left.level))[0];
      next.adminRoleId = readString(assignableRole?.id) ?? next.adminRoleId;
      next.adminRoleRevisionToken = readString(assignableRole?.revision_token) ?? next.adminRoleRevisionToken;
    } else {
      const id = readString(payload.id);
      next.adminRoleId = id ?? next.adminRoleId;
      next.adminRoleRevisionToken = readString(payload.revision_token) ?? next.adminRoleRevisionToken;
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

  if (endpoint.path === "/api/admin/audit-archive/files") {
    if (Array.isArray(payload.files)) {
      const firstFile = payload.files.find((item): item is Record<string, unknown> => isRecord(item));
      next.auditArchiveId = readString(firstFile?.id) ?? next.auditArchiveId;
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
        next.createdBadgeUpdatedAt = readString(payload.updated_at) ?? next.createdBadgeUpdatedAt;
      }
    }
    return next;
  }

  if (endpoint.path === "/api/badges/:id") {
    next.createdBadgeUpdatedAt = readString(payload.updated_at) ?? next.createdBadgeUpdatedAt;
    return next;
  }

  if (endpoint.path.startsWith("/api/guild-war/history/:id")) {
    next.warHistoryEtag = readString(payload.etag) ?? result.etag ?? next.warHistoryEtag;
    return next;
  }

  if (endpoint.path === "/api/badges/:id/assign" || endpoint.path === "/api/badges/:id/unassign") {
    next.createdBadgeUpdatedAt = readString(payload.updated_at) ?? next.createdBadgeUpdatedAt;
    return next;
  }

  const storageContext = captureStorageResponseContext(next, endpoint, payload);
  if (storageContext) return storageContext;

  if (endpoint.path === "/api/site-config" || endpoint.path === "/api/admin/site-config") {
    next.siteLogoMediaId = readString(payload.site_logo_media_id) ?? next.siteLogoMediaId;
    return next;
  }

  return next;
}

function announcementRecordEtag(payload: Record<string, unknown>): string | null {
  const id = readString(payload.id);
  const updatedAt = readString(payload.updated_at);
  return id && updatedAt ? announcementEtag({ id, updated_at: updatedAt }) : null;
}

function wikiRecordEtag(payload: Record<string, unknown>): string | null {
  const id = readString(payload.id);
  const updatedAt = readString(payload.updated_at);
  return id && updatedAt ? wikiArticleEtag({ id, updated_at: updatedAt }) : null;
}

function galleryRecordEtag(payload: Record<string, unknown> | null): string | null {
  const id = readString(payload?.id);
  const revisionToken = readString(payload?.revision_token);
  return id && revisionToken ? makeGalleryItemEtag({ id, revision_token: revisionToken }) : null;
}
