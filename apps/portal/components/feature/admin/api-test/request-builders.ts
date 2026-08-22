import {
  type EndpointDef,
  type PreparedEndpointRequest,
  type TestRunContext,
  disposableMemberId,
} from "./types";
import { DEFAULT_GAME_RULES } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";

export function toIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

/** YYYY-MM-DD，请假接口只收日期不收时刻。 */
export function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/*
 * 冒烟用例直接打接口，绕过了浏览器那一轮转码，所以素材必须已经是能落库的编码：
 * 服务端会按魔术字节复核声明的 MIME；PNG、WAV 这类只在选择器里出现过的格式会被当场拒掉。
 */
function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/** 1×1 无损 WebP（RIFF/WEBP/VP8L）。 */
const TINY_WEBP_BASE64 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

/** 0.1 秒静音，16 kHz 单声道 Opus 装在 Ogg 里——和上传链产出的编码同一套参数。 */
const TINY_OGG_OPUS_BASE64
  = "T2dnUwACAAAAAAAAAABzkiyQAAAAAAq2k/ABE09wdXNIZWFkAQE4AYA+AAAAAABPZ2dTAAAAAAAAAAAAAHOS"
  + "LJABAAAAXjXAPgE+T3B1c1RhZ3MNAAAATGF2ZjYwLjE2LjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNjAuMzEu"
  + "MTAyIGxpYm9wdXNPZ2dTAAT4EwAAAAAAAHOSLJACAAAANztTLwYDAwMDAwO4//64//64//64//64//64//4=";

export function createTinyImageFile(): File {
  return new File([decodeBase64(TINY_WEBP_BASE64)], "systemtest-image.webp", { type: "image/webp" });
}

export function createTinyAudioFile(): File {
  return new File([decodeBase64(TINY_OGG_OPUS_BASE64)], "systemtest-audio.ogg", { type: "audio/ogg" });
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

function buildImageUploadRequest(
  path: string,
  fields: Array<[string, string | File]> = [],
): PreparedEndpointRequest {
  return buildFormRequest(path, [
    ["full", createTinyImageFile()],
    ["view", createTinyImageFile()],
    ...fields,
  ]);
}

function stripTestFixture(path: string): string {
  return path.replace(/\?fixture=[^&]+&?/, "?").replace(/[?&]$/, "");
}

function fixtureName(prefix: string, id: string, maxLength: number): string {
  return `${prefix}${id}`.slice(0, maxLength);
}

function isMutableMethod(method: EndpointDef["method"]): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

export function skipEndpoint(path: string, reason: string, optionalSkip = false): PreparedEndpointRequest {
  return { path, skipReason: reason, optionalSkip };
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

  if (endpoint.path === "/api/media/:mediaId/:variant") {
    const mediaId = endpoint.mediaIdContext ? context[endpoint.mediaIdContext] : null;
    if (!mediaId || !endpoint.mediaVariant) {
      return { path, missing: "media id (run the corresponding upload first)" };
    }
    return {
      path: `/api/media/${encodeURIComponent(mediaId)}/${endpoint.mediaVariant}`,
      missing: null,
    };
  }

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

  if (path.includes(":absenceId")) {
    const next = replacePathParam(path, ":absenceId", context.createdAbsenceId);
    if (!next) {
      return { path, missing: "created absence id (run the absence create first)" };
    }
    path = next;
  }

  if (path.includes("/api/classes/:id")) {
    /* 只允许操作本次跑出来的职业。既有职业被成员档案按名字引用，
       改名或删除都会把线上数据打散，而且没有任何回滚路径。 */
    const next = replacePathParam(path, ":id", context.createdClassId);
    if (!next) {
      return { path, missing: "created class id" };
    }
    path = next;
  }

  if (path.includes("/api/class-tags/:id")) {
    /* 同职业：只动本次运行创建的标签，既有标签被活动配额引用。 */
    const next = replacePathParam(path, ":id", context.createdClassTagId);
    if (!next) {
      return { path, missing: "created class tag id" };
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
    const next = replacePathParam(path, ":imageId", context.storageImageMediaId);
    if (!next) {
      return { path, missing: "created storage image media id" };
    }
    path = next;
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
    const articleId = isMutableMethod(endpoint.method)
      ? context.createdWikiArticleId
      : context.createdWikiArticleId ?? context.wikiArticleId;
    const next = replacePathParam(path, ":id", articleId);
    if (!next) {
      return { path, missing: isMutableMethod(endpoint.method) ? "created wiki article id" : "wiki article id" };
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
  if (endpoint.method === "POST" && endpoint.path === "/api/users/:id/change-password") {
    return skipEndpoint(
      endpoint.path,
      "Skipping password change: the endpoint is self-only, so it would change the running admin's own password",
      true,
    );
  }
  if (endpoint.method === "POST" && endpoint.path === "/api/users/:id/change-username") {
    return skipEndpoint(
      endpoint.path,
      "Skipping username change: the endpoint is self-only and rejects the reserved systemtest prefix",
      true,
    );
  }
  const gameRules = DEFAULT_GAME_RULES;
  const eventTypeForBehavior = (behavior: "standard" | "guild_war" | "poll" | "raffle") =>
    gameRules.events.types.find((definition) => definition.behavior === behavior && definition.enabled)?.id;
  const winningResultId = "win";
  const teamStatsFixture = Object.fromEntries(gameRules.guild_war.team_stats.map((definition, index) => [
    definition.key,
    index === 0 ? 10 : 1,
  ]));
  const enemyTeamStatsFixture = Object.fromEntries(gameRules.guild_war.team_stats.map((definition, index) => [
    definition.key,
    index === 0 ? 5 : 0,
  ]));
  const memberStatsFixture = Object.fromEntries(gameRules.guild_war.member_stats.map((definition, index) => [
    definition.key,
    index === 0 ? 1 : 0,
  ]));
  const resolved = resolveEndpointPath(endpoint, context);
  if (resolved.missing) {
    if (endpoint.path === "/api/admin/audit-archive/download") {
      return skipEndpoint(endpoint.path, "No archived audit month is available in this environment", true);
    }
    if (endpoint.path === "/api/admin/audit-archive/download/file") {
      return skipEndpoint(endpoint.path, "No audit archive download token is available in this environment", true);
    }
    if (endpoint.path === "/api/media/:mediaId/:variant" && endpoint.mediaIdContext === "siteLogoMediaId") {
      return skipEndpoint(endpoint.path, "No site logo is configured; the test intentionally does not replace the live logo", true);
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
        if (!context.uploadedImageMediaId) {
          return skipEndpoint(path, "No test-uploaded image to delete");
        }
        return buildJsonRequest(path, { media_ids: [context.uploadedImageMediaId] });
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
    if (endpoint.path === "/api/guild-war/history/batch") {
      const historyId = context.createdWarHistoryId ?? context.warHistoryId;
      if (!historyId) {
        return skipEndpoint(path, "Missing war history id");
      }
      return { path: `${path}?ids=${encodeURIComponent(historyId)}` };
    }
    return { path };
  }

  const nowId = context.fixtureId?.replaceAll("-", "") ?? "missingfixture";
  switch (`${endpoint.method} ${endpoint.path}`) {
    case "PATCH /api/admin/analytics-settings":
      return skipEndpoint(path, "Skipping global analytics settings mutation to avoid touching existing database state", true);

    /*
     * 下面这五个端点被登记进目录只是为了让覆盖情况可见，它们永远不会真的发出去。
     * 每一条都会改动跑测试这个人自己或整站的状态，而且没有任何回滚路径——
     * 不是「暂时不测」，是「测了就没法还原」。
     */
    case "POST /api/auth/logout":
      return skipEndpoint(path, "Skipping logout because it would terminate the admin session running this console", true);

    case "PATCH /api/admin/site-config":
      return skipEndpoint(path, "Skipping global site config mutation: it has no per-run cleanup path", true);

    case "POST /api/admin/site-config/logo":
      return skipEndpoint(path, "Skipping site logo upload because it replaces the live logo for every visitor", true);

    case "POST /api/classes":
      return buildJsonRequest(path, {
        label: `[systemtest] API Class ${nowId.slice(0, 24)}`,
        color: "#B8922F",
        vector_icon: "sword",
      });

    case "PATCH /api/classes/:id":
      return buildJsonRequest(path, {
        label: `[systemtest] API Class Updated ${nowId.slice(0, 16)}`,
        vector_icon: "shield",
      });

    case "PATCH /api/classes/reorder":
      return skipEndpoint(
        path,
        "Skipping class reorder because the endpoint rewrites the complete live catalog",
        true,
      );

    case "POST /api/classes/:id/icon":
      return buildImageUploadRequest(path);

    case "POST /api/class-tags":
      /* class_ids 留空：职业目录里那枚测试职业在自己那一类收尾时就删掉了，
         标签的成员流转由 e2e 的管理页用例覆盖，这里只体检标签自身的写路径。 */
      return buildJsonRequest(path, {
        label: `[systemtest] API Tag ${nowId.slice(0, 24)}`,
        class_ids: [],
      });

    case "PATCH /api/class-tags/:id":
      return buildJsonRequest(path, {
        label: `[systemtest] API Tag Updated ${nowId.slice(0, 16)}`,
      });

    case "PATCH /api/class-tags/reorder":
      return skipEndpoint(
        path,
        "Skipping class-tag reorder because the endpoint rewrites the complete live catalog",
        true,
      );

    case "POST /api/users/:id/absences":
      return buildJsonRequest(path, {
        start_date: isoDate(30),
        end_date: isoDate(32),
        note: "[systemtest] API absence",
      });

    case "POST /api/wiki/articles/:id/revisions/1/restore":
      return buildJsonRequest(path, {});

    case "POST /api/auth/register/:inviteCode":
      {
        const username = `apitest_${nowId.slice(0, 32)}`;
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
    case "POST /api/users/:id/media/avatar":
      return buildImageUploadRequest(path);

    case "POST /api/users/:id/media/audio":
      return buildFormRequest(path, [["file", createTinyAudioFile()]]);

    case "POST /api/events":
    case "POST /api/events?fixture=guild-war":
    case "POST /api/events?fixture=poll":
    case "POST /api/events?fixture=raffle":
      return buildJsonRequest(path, {
        type: endpoint.path === "/api/events?fixture=guild-war"
          ? eventTypeForBehavior("guild_war")
          : endpoint.path === "/api/events?fixture=poll"
            ? eventTypeForBehavior("poll")
            : endpoint.path === "/api/events?fixture=raffle"
              ? eventTypeForBehavior("raffle")
              : eventTypeForBehavior("standard"),
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
      return buildImageUploadRequest(path);

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

    case "POST /api/events/templates": {
      const start = new Date(Date.now() + 4 * 60 * 60 * 1000);
      return buildJsonRequest(path, {
        type: "social",
        title: `[systemtest] API Template ${nowId}`,
        description: "[systemtest] Recurring template from API tester",
        start_time: start.toISOString().slice(11, 16),
        duration_minutes: 60,
        recurrence_rule: {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: [start.getUTCDay()],
        },
      });
    }

    case "PATCH /api/events/templates/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Template Updated ${nowId}`,
      });

    case "POST /api/announcements": {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "[systemtest] Created by API tester" }],
          },
        ],
      };
      return buildJsonRequest(path, {
        title: `[systemtest] API Announcement ${nowId}`,
        body_json: JSON.stringify(bodyJson),
        pinned: false,
        status: "draft",
      });
    }

    case "PATCH /api/announcements/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Announcement Updated ${nowId}`,
        body_json: JSON.stringify({
          type: "doc",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "[systemtest] Updated by API tester" }],
          }],
        }),
      });

    case "POST /api/announcements/:id/images":
      return buildImageUploadRequest(path);

    case "POST /api/gallery/images":
      return buildImageUploadRequest(path, [
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
          result: winningResultId,
          duration_minutes: 30,
          own_stats: teamStatsFixture,
          enemy_stats: enemyTeamStatsFixture,
        },
        member_stats: [
          {
            user_id: context.warMemberUserId ?? testMemberId,
            stats: memberStatsFixture,
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
        war_name: `[systemtest] API Test War ${nowId}`,
        result: winningResultId,
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

    case "PATCH /api/wiki/categories/batch":
      /* 批量口收的是子集，所以只对本次创建的分类下手；sort_order 写回创建时的 0，
         批量写路径走完，分类的位置一点不动。 */
      if (!context.createdWikiCategoryId) {
        return skipEndpoint(path, "Missing created wiki category id");
      }
      return buildJsonRequest(path, {
        updates: [{ id: context.createdWikiCategoryId, sort_order: 0 }],
      });

    case "POST /api/wiki/articles":
      if (!context.wikiArticleCategoryId && !context.wikiCategoryId) {
        return skipEndpoint(path, "Missing wiki category id");
      }
      return buildJsonRequest(path, {
        title: `[systemtest] API Article ${nowId}`,
        category_id: context.wikiArticleCategoryId ?? context.wikiCategoryId,
        body_json: JSON.stringify({
          type: "doc",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "[systemtest] Created by API tester" }],
          }],
        }),
        sort_order: 0,
      });

    case "PATCH /api/wiki/articles/:id":
      return buildJsonRequest(path, {
        title: `[systemtest] API Article Updated ${nowId}`,
      });

    case "POST /api/wiki/articles/:id/images":
      return buildImageUploadRequest(path);

    case "POST /api/admin/invite-links":
      if (!context.adminRoleId) {
        return skipEndpoint(path, "Missing assignable admin role id");
      }
      return buildJsonRequest(path, {
        role_id: context.adminRoleId,
        max_uses: 1,
      });

    case "POST /api/admin/users":
      if (!context.adminRoleId) {
        return skipEndpoint(path, "Missing assignable admin role id");
      }
      return buildJsonRequest(path, {
        username: `apitestadmin_${nowId.slice(0, 32)}`,
        role_id: context.adminRoleId,
      });

    case "PATCH /api/admin/users/batch/role":
      if (!context.adminCreatedUserId) {
        return skipEndpoint(path, "Missing created admin user id");
      }
      if (!context.adminRoleId) {
        return skipEndpoint(path, "Missing assignable admin role id");
      }
      return buildJsonRequest(path, {
        user_ids: [context.adminCreatedUserId],
        new_role: context.adminRoleId,
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
      if (!context.adminRoleId) {
        return skipEndpoint(path, "Missing assignable admin role id");
      }
      return buildJsonRequest(path, {
        role: context.adminRoleId,
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

    case "POST /api/admin/users/:id/reset-login-lock":
      return buildJsonRequest(path, {});

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
        const adminCredentials = context.adminCreatedUserId
          && context.adminCreatedUsername
          && context.adminCreatedUserPassword
          ? {
              username: context.adminCreatedUsername,
              password: context.adminCreatedUserPassword,
            }
          : null;
        const registeredCredentials = context.registeredUserId
          && context.registeredUsername
          && context.registeredUserPassword
          ? {
              username: context.registeredUsername,
              password: context.registeredUserPassword,
            }
          : null;
        const credentials = adminCredentials ?? registeredCredentials;
        if (!credentials) {
          return skipEndpoint(path, "Requires test user credentials");
        }
        return {
          ...buildJsonRequest(path, credentials),
          credentials: "omit",
        };
      }

    case "POST /api/users/:id/media/avatar":
      return buildFormRequest(path, [["file", createTinyImageFile()]]);

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

    case "PATCH /api/badges/reorder":
      return skipEndpoint(
        path,
        "Skipping badge reorder because the endpoint rewrites the complete live catalog",
        true,
      );

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
    case "POST /api/storage/storages?fixture=transactions":
      return buildJsonRequest(stripTestFixture(path), {
        name: fixtureName(
          endpoint.path.includes("fixture=transactions")
            ? "[systemtest] Transaction Storage "
            : "[systemtest] API Storage ",
          nowId,
          LIMITS.content.storageName.max,
        ),
        description: "[systemtest] Created by admin API tester",
      });

    case "PATCH /api/storage/storages/:id":
      return buildJsonRequest(path, {
        name: fixtureName("[systemtest] API Storage Updated ", nowId, LIMITS.content.storageName.max),
        description: "[systemtest] Updated by admin API tester",
      });

    case "POST /api/storage/storages/:storageId/categories":
    case "POST /api/storage/storages/:storageId/categories?fixture=transactions":
      return buildJsonRequest(stripTestFixture(path), {
        name: fixtureName(
          endpoint.path.includes("fixture=transactions")
            ? "[systemtest] Transaction Category "
            : "[systemtest] API Category ",
          nowId,
          LIMITS.content.storageCategoryName.max,
        ),
      });

    case "PATCH /api/storage/storages/:storageId/categories/:id":
      return buildJsonRequest(path, {
        name: fixtureName("[systemtest] API Category Updated ", nowId, LIMITS.content.storageCategoryName.max),
      });

    case "POST /api/storage/items":
    case "POST /api/storage/items?fixture=transactions":
      if (!context.createdStorageId) {
        return skipEndpoint(path, "Missing created storage id for storage item");
      }
      return buildJsonRequest(stripTestFixture(path), {
        storage_id: context.createdStorageId,
        category_id: context.createdStorageCategoryId,
        name: fixtureName(
          endpoint.path.includes("fixture=transactions")
            ? "[systemtest] Transaction Item "
            : "[systemtest] API Item ",
          nowId,
          LIMITS.content.storageItemName.max,
        ),
        description: "[systemtest] Created by admin API tester",
        allow_member_deposit: true,
        allow_member_withdraw: false,
      });

    case "PATCH /api/storage/items/:id":
      return buildJsonRequest(path, {
        name: fixtureName("[systemtest] API Item Updated ", nowId, LIMITS.content.storageItemName.max),
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

    case "POST /api/storage/transactions/batch":
      if (!context.createdStorageItemId) {
        return skipEndpoint(path, "Missing created storage item for storage batch");
      }
      return buildJsonRequest(path, {
        idempotency_key: crypto.randomUUID(),
        type: "intake",
        entries: [{ item_id: context.createdStorageItemId, quantity: 2 }],
        note: "[systemtest] API storage batch",
      });

    case "POST /api/storage/items/:id/images":
      return buildImageUploadRequest(path);

    default:
      return { path };
  }
}
