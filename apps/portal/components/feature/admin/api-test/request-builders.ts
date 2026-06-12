import {
  type CleanupStep,
  type EndpointDef,
  type PreparedEndpointRequest,
  type TestRunContext,
  disposableMemberId,
} from "./types";

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

function stripTestFixture(path: string): string {
  return path.replace(/\?fixture=[^&]+&?/, "?").replace(/[?&]$/, "");
}

function isMutableMethod(method: EndpointDef["method"]): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

export function skipEndpoint(path: string, reason: string, optionalSkip = false): PreparedEndpointRequest {
  return { path, skipReason: reason, optionalSkip };
}

export function buildCleanupSteps(ctx: TestRunContext): CleanupStep[] {
  const cleanupSteps: CleanupStep[] = [];
  const disposableUserId = disposableMemberId(ctx);

  if (ctx.createdStorageImageId && ctx.createdStorageItemId) {
    cleanupSteps.push({
      label: "Cleanup: Storage Image",
      method: "DELETE",
      path: `/api/storage/items/${encodeURIComponent(ctx.createdStorageItemId)}/images/${encodeURIComponent(ctx.createdStorageImageId)}`,
      clearContext: { createdStorageImageId: null, storageImageKey: null },
    });
  }
  if (ctx.createdStorageItemId) {
    cleanupSteps.push({
      label: "Cleanup: Storage Item",
      method: "DELETE",
      path: `/api/storage/items/${encodeURIComponent(ctx.createdStorageItemId)}`,
      clearContext: { createdStorageItemId: null },
    });
  }
  if (ctx.createdStorageCategoryId && ctx.createdStorageId) {
    cleanupSteps.push({
      label: "Cleanup: Storage Category",
      method: "DELETE",
      path: `/api/storage/storages/${encodeURIComponent(ctx.createdStorageId)}/categories/${encodeURIComponent(ctx.createdStorageCategoryId)}`,
      clearContext: { createdStorageCategoryId: null },
    });
  }
  if (ctx.createdStorageId) {
    cleanupSteps.push({
      label: "Cleanup: Storage",
      method: "DELETE",
      path: `/api/storage/storages/${encodeURIComponent(ctx.createdStorageId)}`,
      clearContext: { createdStorageId: null },
    });
  }

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
  if (disposableUserId && ctx.targetProfileSnapshot) {
    cleanupSteps.push({
      label: "Cleanup: Restore Profile",
      method: "PATCH",
      path: `/api/users/${encodeURIComponent(disposableUserId)}/profile`,
      jsonBody: ctx.targetProfileSnapshot,
      clearContext: { targetProfileSnapshot: null },
    });
  }
  if (disposableUserId && ctx.uploadedImageKey) {
    cleanupSteps.push({
      label: "Cleanup: Test Image",
      method: "DELETE",
      path: `/api/users/${encodeURIComponent(disposableUserId)}/media/images`,
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

export function replacePathParam(path: string, key: string, value: string | null): string | null {
  if (!path.includes(key)) {
    return path;
  }
  if (!value) {
    return null;
  }
  return path.replace(key, encodeURIComponent(value));
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
    const userId = context.adminCreatedUserId ?? context.registeredUserId;
    if (!userId) {
      return { path, missing: "test member id (create/register a disposable member first)" };
    }
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
          : isMutableMethod(endpoint.method) ? context.createdEventId : context.createdEventId ?? context.eventId;
    const next = replacePathParam(path, ":id", eventId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created event id" : "event id" };
    }
    path = next.replace("?fixture=poll", "").replace("?fixture=raffle", "");
  }

  if (path.includes("/api/events/templates/:id")) {
    const next = replacePathParam(path, ":id", isMutableMethod(endpoint.method) ? context.createdTemplateId : context.eventTemplateId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created template id" : "template id" };
    }
    path = next;
  }

  if (path.includes("/api/events/") && path.includes(":userId")) {
    const participantId = context.eventParticipantUserId ?? disposableMemberId(context);
    const next = replacePathParam(path, ":userId", participantId);
    if (!next) {
      return { path, missing: "test member id" };
    }
    path = next;
  }

  if (path.includes("/api/announcements/:id")) {
    const announcementId = isMutableMethod(endpoint.method) ? context.createdAnnouncementId : context.createdAnnouncementId ?? context.announcementId;
    const next = replacePathParam(path, ":id", announcementId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created announcement id" : "announcement id" };
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
      : isMutableMethod(endpoint.method)
        ? context.createdWarHistoryId ?? context.createdConcludedWarHistoryId
        : context.createdWarHistoryId ?? context.createdConcludedWarHistoryId ?? context.warHistoryId;
    const next = replacePathParam(path, ":id", historyId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created guild war history id" : "guild war history id" };
    }
    path = next;
  }

  if (path.includes("/api/guild-war/history/") && path.includes(":userId")) {
    const memberId = context.warMemberUserId ?? disposableMemberId(context);
    if (!memberId) {
      return { path, missing: "test member id" };
    }
    const next = replacePathParam(path, ":userId", memberId);
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

  if (path.includes("/api/storage/storages/:storageId")) {
    const storageId = endpoint.method === "GET" ? context.createdStorageId ?? context.storageId : context.createdStorageId;
    const next = replacePathParam(path, ":storageId", storageId);
    if (!next) {
      return { path, missing: endpoint.method === "GET" ? "storage id" : "created storage id" };
    }
    path = next;
  }

  if (path.includes("/api/storage/storages/:id")) {
    const storageId = endpoint.method === "GET" ? context.createdStorageId ?? context.storageId : context.createdStorageId;
    const next = replacePathParam(path, ":id", storageId);
    if (!next) {
      return { path, missing: endpoint.method === "GET" ? "storage id" : "created storage id" };
    }
    path = next;
  }

  if (path.includes("/api/storage/storages/") && path.includes("/categories/:id")) {
    const categoryId = endpoint.method === "GET" ? context.createdStorageCategoryId ?? context.storageCategoryId : context.createdStorageCategoryId;
    const next = replacePathParam(path, ":id", categoryId);
    if (!next) {
      return { path, missing: endpoint.method === "GET" ? "storage category id" : "created storage category id" };
    }
    path = next;
  }

  if (path.includes("/api/storage/items/:id")) {
    const itemId = endpoint.method === "GET" ? context.createdStorageItemId ?? context.storageItemId : context.createdStorageItemId;
    const next = replacePathParam(path, ":id", itemId);
    if (!next) {
      return { path, missing: endpoint.method === "GET" ? "storage item id" : "created storage item id" };
    }
    path = next;
  }

  if (path.includes("/api/storage/items/") && path.includes(":imageId")) {
    const next = replacePathParam(path, ":imageId", context.createdStorageImageId);
    if (!next) {
      return { path, missing: "created storage image id" };
    }
    path = next;
  }

  if (endpoint.path === "/api/storage/image") {
    if (!context.storageImageKey) {
      return { path, missing: "storage image key (run storage image upload first)" };
    }
    return { path: `/api/storage/image?key=${encodeURIComponent(context.storageImageKey)}`, missing: null };
  }

  if (path.includes("/api/wiki/categories/:id")) {
    const next = replacePathParam(path, ":id", isMutableMethod(endpoint.method) ? context.createdWikiCategoryId : context.wikiCategoryId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created wiki category id" : "wiki category id" };
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

  if (path.includes("/api/wiki/articles/:id/revisions")) {
    const articleId = context.createdWikiArticleId ?? context.wikiArticleId;
    const next = replacePathParam(path, ":id", articleId);
    if (!next) {
      return { path, missing: "wiki article id" };
    }
    path = next;
  }

  if (path.includes("/api/wiki/articles/:id")) {
    const articleId = isMutableMethod(endpoint.method) ? context.createdWikiArticleId : context.createdWikiArticleId ?? context.wikiArticleId;
    const next = replacePathParam(path, ":id", articleId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created wiki article id" : "wiki article id" };
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
    const next = replacePathParam(path, ":id", isMutableMethod(endpoint.method) ? context.createdBadgeId : context.badgeId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created badge id" : "badge id" };
    }
    path = next;
  }

  if (path.includes("/api/admin/invite-links/:id")) {
    const inviteId = endpoint.method === "DELETE" ? context.createdInviteLinkId : context.inviteLinkId;
    const next = replacePathParam(path, ":id", inviteId);
    if (!next) {
      return { path, missing: endpoint.method === "DELETE" ? "created invite id" : "invite id" };
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
    const next = replacePathParam(path, ":id", isMutableMethod(endpoint.method) ? context.createdRoleId : context.adminRoleId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created admin role id" : "admin role id" };
    }
    path = next;
  }

  return { path, missing: null };
}

export function prepareEndpointRequest(endpoint: EndpointDef, context: TestRunContext): PreparedEndpointRequest {
  const resolved = resolveEndpointPath(endpoint, context);
  if (resolved.missing) {
    if (endpoint.path === "/api/admin/audit-archive/download") {
      return skipEndpoint(endpoint.path, "No archived audit month is available in this environment", true);
    }
    if (endpoint.path === "/api/admin/audit-archive/download/file") {
      return skipEndpoint(endpoint.path, "No audit archive download token is available in this environment", true);
    }
    return skipEndpoint(endpoint.path, `Missing ${resolved.missing}`);
  }
  const path = resolved.path;
  const testMemberId = disposableMemberId(context);

  if (endpoint.method === "DELETE") {
    switch (endpoint.path) {
      case "/api/events/:id/leave":
        return { path };
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
        if (!context.eventParticipantUserId && !testMemberId) {
          return skipEndpoint(path, "Missing test member id");
        }
        return buildJsonRequest(path, {
          user_ids: [context.eventParticipantUserId ?? testMemberId],
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
      return skipEndpoint(path, "Skipping global analytics settings mutation to avoid touching existing database state", true);

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

    case "POST /api/events/:id/join":
      return { path };

    case "POST /api/events/:id/participants":
    case "POST /api/events/:id/participants?fixture=raffle":
      if (!testMemberId) {
        return skipEndpoint(path, "Missing test member id");
      }
      return buildJsonRequest(path, {
        user_ids: [testMemberId],
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
      if (!context.createdGuildWarEventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing created event id for guild war teams");
      }
      if (!testMemberId) {
        return skipEndpoint(path, "Missing test member id for guild war teams");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId,
        teams: [
          {
            team_name: "[systemtest] API Team A",
            sort_order: 0,
            is_locked: false,
            members: [
              {
                user_id: testMemberId,
                sort_order: 0,
              },
            ],
          },
        ],
        pool_members: [],
      });

    case "POST /api/guild-war/move":
      if (!context.createdGuildWarEventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing created event id for guild war move");
      }
      if (!context.warMemberUserId && !testMemberId) {
        return skipEndpoint(path, "Missing test member id for guild war move");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId,
        moves: [{ user_id: context.warMemberUserId ?? testMemberId, to: "pool" }],
      });

    case "POST /api/guild-war/conclude":
      if (!context.createdGuildWarEventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing created event id for guild war conclude");
      }
      if (!context.warMemberUserId && !testMemberId) {
        return skipEndpoint(path, "Missing test member id for guild war conclude");
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
            user_id: context.warMemberUserId ?? testMemberId,
            stats: { kills: 1 },
          },
        ],
      });

    case "PATCH /api/guild-war/role-tag":
      if (!context.createdGuildWarEventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing created event id for role tag");
      }
      if (!context.warMemberUserId && !testMemberId) {
        return skipEndpoint(path, "Missing test member id for role tag");
      }
      return buildJsonRequest(path, {
        event_id: context.createdGuildWarEventId ?? context.createdEventId,
        updates: [{ user_id: context.warMemberUserId ?? testMemberId, role_tag: "DPS" }],
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
      if (!context.warMemberUserId && !testMemberId) {
        return skipEndpoint(path, "Missing test member id for member stats update");
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
        color: "#B8922F",
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
      if (!context.createdConcludedWarHistoryId || (!context.warMemberUserId && !testMemberId)) {
        return skipEndpoint(path, "Missing war history id or test member id");
      }
      return buildJsonRequest(path, {
        updates: [{ user_id: context.warMemberUserId ?? testMemberId, stats: { stats: { kills: 2 } } }],
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
      if (!testMemberId) {
        return skipEndpoint(path, "Missing test member id for badge assign");
      }
      return buildJsonRequest(path, {
        user_ids: [testMemberId],
      });

    case "POST /api/badges/:id/unassign":
      if (!testMemberId) {
        return skipEndpoint(path, "Missing test member id for badge unassign");
      }
      return buildJsonRequest(path, {
        user_ids: [testMemberId],
      });

    case "POST /api/storage/storages":
      return buildJsonRequest(path, {
        name: `[systemtest] API Storage ${nowId}`,
        description: "[systemtest] Created by admin API tester",
      });

    case "PATCH /api/storage/storages/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Storage Updated ${nowId}`,
        description: "[systemtest] Updated by admin API tester",
      });

    case "POST /api/storage/storages/:storageId/categories":
      return buildJsonRequest(path, {
        name: `[systemtest] API Category ${nowId}`,
      });

    case "PATCH /api/storage/storages/:storageId/categories/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Category Updated ${nowId}`,
      });

    case "POST /api/storage/items":
      if (!context.createdStorageId) {
        return skipEndpoint(path, "Missing created storage id for storage item");
      }
      return buildJsonRequest(path, {
        storage_id: context.createdStorageId,
        category_id: context.createdStorageCategoryId,
        name: `[systemtest] API Item ${nowId}`,
        description: "[systemtest] Created by admin API tester",
        allow_member_deposit: true,
        allow_member_withdraw: false,
      });

    case "PATCH /api/storage/items/:id":
      return buildJsonRequest(path, {
        name: `[systemtest] API Item Updated ${nowId}`,
        description: "[systemtest] Updated by admin API tester",
        allow_member_deposit: true,
        allow_member_withdraw: true,
      });

    case "POST /api/storage/items/:id/transactions?fixture=intake":
      return buildJsonRequest(stripTestFixture(path), {
        type: "intake",
        quantity: 3,
        note: "[systemtest] API storage intake",
      });

    case "POST /api/storage/items/:id/transactions?fixture=distribute":
      if (!testMemberId) {
        return skipEndpoint(stripTestFixture(path), "Missing test member id for storage distribution");
      }
      return buildJsonRequest(stripTestFixture(path), {
        type: "distribute",
        quantity: 1,
        recipient_user_id: testMemberId,
        note: "[systemtest] API storage distribution",
      });

    case "POST /api/storage/items/:id/transactions?fixture=adjust":
      return buildJsonRequest(stripTestFixture(path), {
        type: "adjust",
        target_quantity: 6,
        note: "[systemtest] API storage adjustment",
      });

    case "POST /api/storage/items/:id/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/storage/intake-batch":
      if (!context.createdStorageItemId) {
        return skipEndpoint(path, "Missing created storage item id for batch intake");
      }
      return buildJsonRequest(path, {
        entries: [{ item_id: context.createdStorageItemId, quantity: 2 }],
        note: "[systemtest] API storage batch intake",
      });

    default:
      return { path };
  }
}
