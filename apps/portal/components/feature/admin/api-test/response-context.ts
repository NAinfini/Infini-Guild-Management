import {
  type EndpointDef,
  type EndpointResult,
  type TestRunContext,
  disposableMemberId,
  firstArrayItem,
  isProfileMediaKey,
  isRecord,
  readString,
} from "./types";

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
    return next;
  }

  if (endpoint.path === "/api/auth/register/:inviteCode") {
    const userId = readString(payload.user_id) ?? readString((isRecord(payload.user) ? payload.user : null)?.id);
    next.registeredUserId = userId ?? next.registeredUserId;
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
      const profile = isRecord(first.profile) ? first.profile : null;
      const images = Array.isArray(profile?.images) ? profile.images : [];
      const firstImage = images.find((item): item is string => typeof item === "string");
      const profileImageKey = firstImage ?? null;
      next.userImageKey = isProfileMediaKey(profileImageKey) ? profileImageKey : next.userImageKey;
      next.userAudioKey = readString(profile?.audio_key) ?? next.userAudioKey;
    }
    return next;
  }

  if (endpoint.path === "/api/users/:id") {
    const profile = isRecord(payload.profile) ? payload.profile : null;
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
