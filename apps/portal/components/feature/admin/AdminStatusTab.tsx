import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ProgressButton } from "@portal/components/effects";
import { PortalCard } from "../../shared/PortalCard";
import { IconClipboard, IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { useClipboard } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../../stores/auth";
import { userCanViewStatus } from "../../../utils/permissions";
import { formatDateTime } from "../../../utils/admin";
import { AdminSystemSection } from "./AdminSystemSection";

type StatusData = {
  db: string;
  r2: string;
  ws: string;
  crons: string;
};

type StatusHealthLog = {
  at: string;
  db: string;
  r2: string;
  ws: string;
  crons: string;
  latencyMs: number | null;
};

type AdminStatusTabProps = {
  onCopyConfigSummary: () => void;
  canCopyConfigSummary: boolean;
  statusLatencyMs: number | null;
  statusLoading: boolean;
  statusError: boolean;
  statusData: StatusData | null;
  statusHealthLogs: StatusHealthLog[];
};

// ─── API Test Infrastructure ─────────────────────────────────────────

type EndpointDef = {
  /** Display label */
  label: string;
  /** HTTP method */
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** URL path (may include query params) */
  path: string;
};

type CategoryDef = {
  key: string;
  label: string;
  endpoints: EndpointDef[];
};

type TestRunContext = {
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
  botGuildId: string | null;
  botNotificationChannelId: string | null;
  botTeamCompChannelId: string | null;
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
  targetProfileSnapshot: { bio: string | null; classes: string[]; discord_reminder_opt_out: boolean } | null;
};

type PreparedEndpointRequest = {
  path: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  credentials?: RequestCredentials;
  skipReason?: string;
};

const API_TEST_GAP_GET_MS = 90;
const API_TEST_GAP_MUTATION_MS = 900;

function createInitialTestRunContext(): TestRunContext {
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
    botGuildId: null,
    botNotificationChannelId: null,
    botTeamCompChannelId: null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstArrayItem(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const first = value[0];
  return isRecord(first) ? first : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function createTinyPngFile(): File {
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

function createTinyAudioFile(): File {
  const payload = new Uint8Array([82, 73, 70, 70, 24, 0, 0, 0, 87, 65, 86, 69]);
  return new File([payload], "systemtest-audio.wav", { type: "audio/wav" });
}

function buildJsonRequest(path: string, body: unknown): PreparedEndpointRequest {
  return {
    path,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

function buildFormRequest(path: string, fields: Array<[string, string | File]>): PreparedEndpointRequest {
  const form = new FormData();
  for (const [key, value] of fields) {
    form.append(key, value);
  }
  return { path, body: form };
}

function skipEndpoint(path: string, reason: string): PreparedEndpointRequest {
  return { path, skipReason: reason };
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
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

function readRetryAfterSeconds(payload: unknown): number | null {
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

function replacePathParam(path: string, key: string, value: string | null): string | null {
  if (!path.includes(key)) {
    return path;
  }
  if (!value) {
    return null;
  }
  return path.replace(key, encodeURIComponent(value));
}

const API_CATEGORIES: CategoryDef[] = [
  {
    key: "system",
    label: "System",
    endpoints: [
      { label: "Health Check", method: "GET", path: "/api/health" },
      { label: "Admin Status", method: "GET", path: "/api/admin/status" },
      { label: "Bot Settings Prep", method: "GET", path: "/api/admin/bot-settings" },
      { label: "Analytics Settings", method: "GET", path: "/api/admin/analytics-settings" },
      { label: "Update Analytics Settings", method: "PATCH", path: "/api/admin/analytics-settings" },
    ],
  },
  {
    key: "auth",
    label: "Auth",
    endpoints: [
      { label: "Check Username", method: "GET", path: "/api/auth/check-username?username=test" },
      { label: "Current User (me)", method: "GET", path: "/api/auth/me" },
      { label: "Register Invite Prep", method: "GET", path: "/api/admin/invite-links" },
      { label: "Register", method: "POST", path: "/api/auth/register/:inviteCode" },
    ],
  },
  {
    key: "users",
    label: "Users",
    endpoints: [
      { label: "List Users", method: "GET", path: "/api/users?page=1&limit=5" },
      { label: "Get User by ID", method: "GET", path: "/api/users/:id" },
      { label: "Update Profile", method: "PATCH", path: "/api/users/:id/profile" },
      { label: "Upload Image", method: "POST", path: "/api/users/:id/media/images" },
      { label: "Delete Image", method: "DELETE", path: "/api/users/:id/media/images/:key" },
      { label: "Upload Audio", method: "POST", path: "/api/users/:id/media/audio" },
      { label: "Delete Audio", method: "DELETE", path: "/api/users/:id/media/audio" },
      { label: "Discord Link Verify", method: "POST", path: "/api/users/:id/discord-link/verify" },
      { label: "Discord Unlink", method: "DELETE", path: "/api/users/:id/discord-link" },
      { label: "Change Password", method: "POST", path: "/api/users/:id/change-password" },
      { label: "Change Username", method: "POST", path: "/api/users/:id/change-username" },
    ],
  },
  {
    key: "events",
    label: "Events",
    endpoints: [
      { label: "List Events", method: "GET", path: "/api/events?page=1&limit=5" },
      { label: "Create Event", method: "POST", path: "/api/events" },
      { label: "Get Event", method: "GET", path: "/api/events/:id" },
      { label: "Update Event", method: "PATCH", path: "/api/events/:id" },
      { label: "Upload Event Images", method: "POST", path: "/api/events/:id/images" },
      { label: "Join Event", method: "POST", path: "/api/events/:id/join" },
      { label: "Add Participant", method: "POST", path: "/api/events/:id/participants" },
      { label: "Remove Participant", method: "DELETE", path: "/api/events/:id/participants/:userId" },
      { label: "Leave Event", method: "DELETE", path: "/api/events/:id/leave" },
      { label: "List Templates", method: "GET", path: "/api/events/templates/list" },
      { label: "Create Template", method: "POST", path: "/api/events/templates" },
      { label: "Update Template", method: "PATCH", path: "/api/events/templates/:id" },
      { label: "Pause Template", method: "POST", path: "/api/events/templates/:id/pause" },
      { label: "Resume Template", method: "POST", path: "/api/events/templates/:id/resume" },
      { label: "Delete Template", method: "DELETE", path: "/api/events/templates/:id" },
      { label: "Archive Event", method: "DELETE", path: "/api/events/:id" },
      { label: "Destroy Event", method: "DELETE", path: "/api/events/:id/destroy" },
    ],
  },
  {
    key: "announcements",
    label: "Announcements",
    endpoints: [
      { label: "List Announcements", method: "GET", path: "/api/announcements?page=1&limit=5" },
      { label: "Create Announcement", method: "POST", path: "/api/announcements" },
      { label: "Get Announcement", method: "GET", path: "/api/announcements/:id" },
      { label: "Update Announcement", method: "PATCH", path: "/api/announcements/:id" },
      { label: "Upload Images", method: "POST", path: "/api/announcements/:id/images" },
      { label: "Archive Announcement", method: "DELETE", path: "/api/announcements/:id" },
    ],
  },
  {
    key: "gallery",
    label: "Gallery",
    endpoints: [
      { label: "List Gallery", method: "GET", path: "/api/gallery?limit=5" },
      { label: "Upload Images", method: "POST", path: "/api/gallery/images" },
      { label: "Add Video", method: "POST", path: "/api/gallery/videos" },
      { label: "Like Item", method: "POST", path: "/api/gallery/:id/like" },
      { label: "List Comments", method: "GET", path: "/api/gallery/:id/comments" },
      { label: "Add Comment", method: "POST", path: "/api/gallery/:id/comments" },
      { label: "Edit Comment", method: "PATCH", path: "/api/gallery/:id/comments/:commentId" },
      { label: "Delete Comment", method: "DELETE", path: "/api/gallery/:id/comments/:commentId" },
      { label: "Delete Item", method: "DELETE", path: "/api/gallery/:id" },
    ],
  },
  {
    key: "guildWar",
    label: "Guild War",
    endpoints: [
      { label: "Active War", method: "GET", path: "/api/guild-war/active" },
      { label: "Save Teams", method: "POST", path: "/api/guild-war/save-teams" },
      { label: "Move Member", method: "POST", path: "/api/guild-war/move" },
      { label: "Update Role Tag", method: "PATCH", path: "/api/guild-war/role-tag" },
      { label: "Post Teams", method: "POST", path: "/api/guild-war/post-teams" },
      { label: "Post Results", method: "POST", path: "/api/guild-war/post-results" },
      { label: "Export", method: "GET", path: "/api/guild-war/export?format=json" },
      { label: "War History", method: "GET", path: "/api/guild-war/history?page=1&limit=5" },
      { label: "History Detail", method: "GET", path: "/api/guild-war/history/:id" },
      { label: "Create History", method: "POST", path: "/api/guild-war/history" },
      { label: "Update History", method: "PATCH", path: "/api/guild-war/history/:id" },
      { label: "Update Member Stats", method: "PATCH", path: "/api/guild-war/history/:id/member-stats/:userId" },
      { label: "Analytics", method: "GET", path: "/api/guild-war/analytics" },
      { label: "Delete History", method: "DELETE", path: "/api/guild-war/history/:id" },
    ],
  },
  {
    key: "wiki",
    label: "Wiki",
    endpoints: [
      { label: "List Categories", method: "GET", path: "/api/wiki/categories" },
      { label: "Create Category", method: "POST", path: "/api/wiki/categories" },
      { label: "Update Category", method: "PATCH", path: "/api/wiki/categories/:id" },
      { label: "List Articles", method: "GET", path: "/api/wiki/articles?page=1&limit=5" },
      { label: "Create Article", method: "POST", path: "/api/wiki/articles" },
      { label: "Get Article", method: "GET", path: "/api/wiki/articles/:slug" },
      { label: "Update Article", method: "PATCH", path: "/api/wiki/articles/:id" },
      { label: "Upload Article Images", method: "POST", path: "/api/wiki/articles/:id/images" },
      { label: "Archive Article", method: "DELETE", path: "/api/wiki/articles/:id" },
      { label: "Delete Category", method: "DELETE", path: "/api/wiki/categories/:id" },
    ],
  },
  {
    key: "adminInvites",
    label: "Admin — Invites",
    endpoints: [
      { label: "List Invite Links", method: "GET", path: "/api/admin/invite-links" },
      { label: "Invite Stats", method: "GET", path: "/api/admin/invite-links/stats" },
      { label: "Create Invite", method: "POST", path: "/api/admin/invite-links" },
      { label: "Revoke Invite", method: "DELETE", path: "/api/admin/invite-links/:id" },
    ],
  },
  {
    key: "adminAudit",
    label: "Admin — Audit",
    endpoints: [
      { label: "Audit Log", method: "GET", path: "/api/admin/audit-log?page=1&limit=5" },
      { label: "Audit Log Export", method: "GET", path: "/api/admin/audit-log/export?format=json" },
      { label: "Archive Months", method: "GET", path: "/api/admin/audit-archive/months" },
      { label: "Archive Download", method: "GET", path: "/api/admin/audit-archive/download" },
      { label: "Archive Download File", method: "GET", path: "/api/admin/audit-archive/download/file" },
      { label: "Archive by Month", method: "GET", path: "/api/admin/audit-archive/:month" },
    ],
  },
  {
    key: "adminUsers",
    label: "Admin — Users",
    endpoints: [
      { label: "Create Member", method: "POST", path: "/api/admin/users" },
      { label: "Change User Role", method: "PATCH", path: "/api/admin/users/:id/role" },
      { label: "Deactivate User", method: "PATCH", path: "/api/admin/users/:id/deactivate" },
      { label: "Reactivate User", method: "PATCH", path: "/api/admin/users/:id/reactivate" },
      { label: "Reset Password", method: "POST", path: "/api/admin/users/:id/reset-password" },
      { label: "Batch Role Change", method: "PATCH", path: "/api/admin/users/batch/role" },
      { label: "Batch Deactivate", method: "PATCH", path: "/api/admin/users/batch/deactivate" },
      { label: "Batch Reactivate", method: "PATCH", path: "/api/admin/users/batch/reactivate" },
      { label: "Batch Delete", method: "PATCH", path: "/api/admin/users/batch/delete" },
    ],
  },
  {
    key: "adminRoles",
    label: "Admin — Roles",
    endpoints: [
      { label: "List Roles", method: "GET", path: "/api/admin/roles" },
      { label: "Create Role", method: "POST", path: "/api/admin/roles" },
      { label: "Update Role", method: "PATCH", path: "/api/admin/roles/:id" },
      { label: "Delete Role", method: "DELETE", path: "/api/admin/roles/:id" },
    ],
  },
  {
    key: "adminBot",
    label: "Admin — Bot",
    endpoints: [
      { label: "Bot Settings", method: "GET", path: "/api/admin/bot-settings" },
      { label: "Discord Channels", method: "GET", path: "/api/admin/bot-settings/discord/channels" },
      { label: "Update Bot Settings", method: "PATCH", path: "/api/admin/bot-settings" },
      { label: "Test Bot", method: "POST", path: "/api/admin/bot-settings/test" },
    ],
  },
];

function resolveEndpointPath(endpoint: EndpointDef, context: TestRunContext): { path: string; missing: string | null } {
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

  if (endpoint.path === "/api/admin/bot-settings/discord/channels") {
    if (!context.botGuildId) {
      return { path, missing: "discord guild id (configure bot settings first)" };
    }
    return { path: `/api/admin/bot-settings/discord/channels?guild_id=${encodeURIComponent(context.botGuildId)}`, missing: null };
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
      endpoint.path.includes("/discord-link/verify") ||
      endpoint.path.endsWith("/discord-link");
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

function prepareEndpointRequest(endpoint: EndpointDef, context: TestRunContext): PreparedEndpointRequest {
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
        discord_reminder_opt_out: false,
      });

    case "POST /api/users/:id/media/images":
      return buildFormRequest(path, [["file", createTinyPngFile()]]);

    case "POST /api/users/:id/media/audio":
      return buildFormRequest(path, [["file", createTinyAudioFile()]]);

    case "POST /api/users/:id/discord-link/verify":
      return skipEndpoint(path, "Requires an active Discord link verification code");

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
        notify_discord: false,
        notify_wechat: false,
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

    case "POST /api/guild-war/post-teams":
      if (!context.warEventId && !context.eventId && !context.createdEventId) {
        return skipEndpoint(path, "Missing event id for post-teams");
      }
      if (!context.botTeamCompChannelId) {
        return skipEndpoint(path, "Missing Discord team composition channel in bot settings");
      }
      return buildJsonRequest(path, {
        event_id: context.warEventId ?? context.eventId ?? context.createdEventId,
        platform: "discord",
      });

    case "POST /api/guild-war/post-results":
      if (!context.warHistoryId) {
        return skipEndpoint(path, "Missing war history id for post-results");
      }
      if (!context.botNotificationChannelId && !context.botTeamCompChannelId) {
        return skipEndpoint(path, "Missing Discord notification/team comp channel in bot settings");
      }
      return buildJsonRequest(path, {
        war_history_id: context.warHistoryId,
        platform: "discord",
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

    case "PATCH /api/admin/bot-settings":
      return buildJsonRequest(path, {
        discord: {
          guild_id: context.botGuildId ?? "",
          notification_channel_id: context.botNotificationChannelId ?? "",
          team_comp_channel_id: context.botTeamCompChannelId ?? "",
          default_toggles: {},
        },
        wechat: {
          room_ids: [],
          default_toggles: {},
        },
      });

    case "POST /api/admin/bot-settings/test":
      if (!context.botNotificationChannelId && !context.botTeamCompChannelId) {
        return skipEndpoint(path, "Missing Discord notification/team comp channel in bot settings");
      }
      return buildJsonRequest(path, {
        platform: "discord",
      });

    default:
      return { path };
  }
}

function captureContextFromResponse(
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
      const optOut = typeof profile.discord_reminder_opt_out === "boolean" ? profile.discord_reminder_opt_out : false;
      next.targetProfileSnapshot = { bio, classes, discord_reminder_opt_out: optOut };
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

  if (endpoint.path === "/api/admin/bot-settings") {
    const discord = isRecord(payload.discord) ? payload.discord : null;
    next.botGuildId = readString(discord?.guild_id) ?? next.botGuildId;
    next.botNotificationChannelId = readString(discord?.notification_channel_id) ?? next.botNotificationChannelId;
    next.botTeamCompChannelId = readString(discord?.team_comp_channel_id) ?? next.botTeamCompChannelId;
    return next;
  }

  return next;
}

type EndpointResult = {
  status: number | null;
  latencyMs: number;
  body: string;
  error: string | null;
  ranAt: string;
  parsedJson: unknown | null;
};

type DebugLogEntry = {
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

function methodColor(method: string): string {
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

function statusColor(status: number | null): string {
  if (status === null) return "gray";
  if (status >= 200 && status < 300) return "green";
  if (status >= 400 && status < 500) return "yellow";
  return "red";
}

function truncateJson(json: string, maxLen = 2000): string {
  if (json.length <= maxLen) return json;
  return `${json.slice(0, maxLen)}\n... (truncated)`;
}

async function runEndpointTest(
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
function nextLogId(): string {
  logIdCounter += 1;
  return `log-${Date.now()}-${logIdCounter}`;
}

function EndpointRow({
  endpoint,
  running,
  result,
}: {
  endpoint: EndpointDef;
  running: boolean;
  result: EndpointResult | null;
}) {
  return (
    <Group gap={8} wrap="nowrap" justify="space-between">
      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Badge size="xs" variant="light" color={methodColor(endpoint.method)} style={{ flexShrink: 0 }}>
          {endpoint.method}
        </Badge>
        <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
          {endpoint.label}
        </Text>
        <Text size="xs" c="dimmed" truncate style={{ maxWidth: 260 }}>
          {endpoint.path}
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {result ? (
          <>
            <Badge size="xs" variant="filled" color={statusColor(result.status)}>
              {result.status ?? "ERR"}
            </Badge>
            <Text size="xs" c="dimmed">{result.latencyMs}ms</Text>
          </>
        ) : null}
        {running ? (
          <Badge size="xs" variant="light" color="blue">running</Badge>
        ) : null}
      </Group>
    </Group>
  );
}

function ApiTestCategory({
  category,
  onRunCategory,
  runningSet,
  resultMap,
  runLabel,
}: {
  category: CategoryDef;
  onRunCategory: (cat: CategoryDef) => Promise<void>;
  runningSet: Set<string>;
  resultMap: Map<string, EndpointResult>;
  runLabel: string;
}) {
  const catRunning = category.endpoints.some((ep) => runningSet.has(`${ep.method}-${ep.path}`));

  return (
    <Stack gap={6}>
      <Group justify="flex-end" mb={4}>
        <ProgressButton
          onPress={() => onRunCategory(category)}
          loadingLabel={runLabel}
          successLabel={runLabel}
          errorLabel={runLabel}
          disabled={catRunning}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconPlayerPlay size={14} />
            <span>{runLabel}</span>
          </span>
        </ProgressButton>
      </Group>
      {category.endpoints.map((ep) => {
        const key = `${ep.method}-${ep.path}`;
        return (
          <EndpointRow
            key={key}
            endpoint={ep}
            running={runningSet.has(key)}
            result={resultMap.get(key) ?? null}
          />
        );
      })}
    </Stack>
  );
}

// ─── Debug Console ──────────────────────────────────────────────────

function formatLogEntry(entry: DebugLogEntry): string {
  const statusStr = entry.status !== null ? String(entry.status) : "ERR";
  const errorStr = entry.error ? ` | ERROR: ${entry.error}` : "";
  const header = `[${entry.ranAt}] ${entry.method} ${entry.path} → ${statusStr} (${entry.latencyMs}ms)${errorStr}`;
  if (!entry.body) return header;
  return `${header}\n${entry.body}`;
}

function DebugConsole({
  logs,
  onClear,
}: {
  logs: DebugLogEntry[];
  onClear: () => void;
}) {
  const { t } = useTranslation("admin");
  const clipboard = useClipboard();

  const copyAll = useCallback(() => {
    const text = logs.map(formatLogEntry).join("\n\n" + "─".repeat(80) + "\n\n");
    clipboard.copy(text);
  }, [logs]);

  const consoleText = logs.length === 0
    ? t("status.api.debugEmpty")
    : logs.map(formatLogEntry).join("\n\n" + "─".repeat(80) + "\n\n");

  return (
    <PortalCard interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Group justify="space-between" mb={8}>
          <Group gap={8}>
            <Text fw={600} size="sm">{t("status.api.debugTitle")}</Text>
            <Badge size="xs" variant="light" color="gray">{logs.length}</Badge>
          </Group>
          <Group gap={4}>
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={copyAll}
              disabled={logs.length === 0}
              aria-label={t("status.api.copyAll")}
            >
              <IconClipboard size={14} />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={onClear}
              disabled={logs.length === 0}
              aria-label={t("status.api.clearDebug")}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        </Group>
        <ScrollArea.Autosize mah={400}>
          <Code block style={{ fontSize: 11, whiteSpace: "pre-wrap", minHeight: 60 }}>
            {consoleText}
          </Code>
        </ScrollArea.Autosize>
      </div>
    </PortalCard>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function AdminStatusTab({
  onCopyConfigSummary,
  canCopyConfigSummary,
  statusLatencyMs,
  statusLoading,
  statusError,
  statusData,
  statusHealthLogs,
}: AdminStatusTabProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");
  const user = useAuthStore((state) => state.user);
  const isAdmin = userCanViewStatus(user);
  const loadErrorMessage = tc("loadError");
  const heading = <Title order={3} style={{ margin: 0, fontSize: 16 }}>{t("tab.status")}</Title>;
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [runningSet, setRunningSet] = useState<Set<string>>(new Set());
  const [resultMap, setResultMap] = useState<Map<string, EndpointResult>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef<TestRunContext>(createInitialTestRunContext());

  const pushLog = useCallback((entry: DebugLogEntry) => {
    setDebugLogs((prev) => [...prev, entry]);
  }, []);

  const clearRunConsole = useCallback(() => {
    setDebugLogs([]);
    if (typeof window !== "undefined" && window.console?.clear) {
      window.console.clear();
    }
  }, []);

  const runCategoryInternal = useCallback(async (category: CategoryDef, signal: AbortSignal) => {
    const epKeys = category.endpoints.map((ep) => `${ep.method}-${ep.path}`);
    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.add(k);
      return next;
    });

    for (const ep of category.endpoints) {
      if (signal.aborted) break;
      const key = `${ep.method}-${ep.path}`;
      const prepared = prepareEndpointRequest(ep, contextRef.current);

      const requestGapMs = ep.method === "GET" ? API_TEST_GAP_GET_MS : API_TEST_GAP_MUTATION_MS;
      await waitWithAbort(requestGapMs, signal);
      if (signal.aborted) {
        break;
      }

      setRunningSet((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });

      let result = await runEndpointTest(ep, prepared, signal);
      if (result.status === 429) {
        const retryAfterSeconds = readRetryAfterSeconds(result.parsedJson);
        if (retryAfterSeconds !== null) {
          await waitWithAbort((retryAfterSeconds + 1) * 1000, signal);
          if (!signal.aborted) {
            result = await runEndpointTest(ep, prepared, signal);
          }
        }
      }

      if (signal.aborted) break;
      contextRef.current = captureContextFromResponse(contextRef.current, ep, result);

      setResultMap((prev) => {
        const next = new Map(prev);
        next.set(key, result);
        return next;
      });

      setRunningSet((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      pushLog({
        id: nextLogId(),
        category: category.label,
        label: ep.label,
        method: ep.method,
        path: prepared.path,
        status: result.status,
        latencyMs: result.latencyMs,
        error: result.error,
        body: result.body,
        ranAt: result.ranAt,
      });
    }

    setRunningSet((prev) => {
      const next = new Set(prev);
      for (const k of epKeys) next.delete(k);
      return next;
    });
  }, [pushLog]);

  const runCategory = useCallback(async (category: CategoryDef) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearRunConsole();
    await runCategoryInternal(category, controller.signal);
  }, [clearRunConsole, runCategoryInternal]);

  const [runningAll, setRunningAll] = useState(false);

  const runCleanup = useCallback(async (signal: AbortSignal) => {
    const ctx = contextRef.current;
    const cleanupSteps: Array<{ label: string; method: string; path: string; jsonBody?: unknown }> = [];

    // Order: dependents first, then parents
    // Gallery image (the uploaded image that survived the in-category delete of the video)
    if (ctx.createdGalleryImageId) {
      cleanupSteps.push({ label: "Cleanup: Gallery Image", method: "DELETE", path: `/api/gallery/${encodeURIComponent(ctx.createdGalleryImageId)}` });
    }
    // Announcement (archive = soft delete)
    if (ctx.createdAnnouncementId) {
      cleanupSteps.push({ label: "Cleanup: Announcement", method: "DELETE", path: `/api/announcements/${encodeURIComponent(ctx.createdAnnouncementId)}` });
    }
    // Wiki article before category (article depends on category)
    if (ctx.createdWikiArticleId) {
      cleanupSteps.push({ label: "Cleanup: Wiki Article", method: "DELETE", path: `/api/wiki/articles/${encodeURIComponent(ctx.createdWikiArticleId)}` });
    }
    if (ctx.createdWikiCategoryId) {
      cleanupSteps.push({ label: "Cleanup: Wiki Category", method: "DELETE", path: `/api/wiki/categories/${encodeURIComponent(ctx.createdWikiCategoryId)}` });
    }
    // Guild war history
    if (ctx.createdWarHistoryId) {
      cleanupSteps.push({ label: "Cleanup: War History", method: "DELETE", path: `/api/guild-war/history/${encodeURIComponent(ctx.createdWarHistoryId)}` });
    }
    // Invite link
    if (ctx.createdInviteLinkId) {
      cleanupSteps.push({ label: "Cleanup: Invite Link", method: "DELETE", path: `/api/admin/invite-links/${encodeURIComponent(ctx.createdInviteLinkId)}` });
    }
    // Admin role
    if (ctx.createdRoleId) {
      cleanupSteps.push({ label: "Cleanup: Admin Role", method: "DELETE", path: `/api/admin/roles/${encodeURIComponent(ctx.createdRoleId)}` });
    }
    // Restore modified profile to original values
    if (ctx.targetUserId && ctx.targetProfileSnapshot) {
      cleanupSteps.push({
        label: "Cleanup: Restore Profile",
        method: "PATCH",
        path: `/api/users/${encodeURIComponent(ctx.targetUserId)}/profile`,
        jsonBody: {
          bio: ctx.targetProfileSnapshot.bio,
          classes: ctx.targetProfileSnapshot.classes,
          discord_reminder_opt_out: ctx.targetProfileSnapshot.discord_reminder_opt_out,
        },
      });
    }
    // Delete registered test user (batch delete via admin)
    if (ctx.registeredUserId) {
      cleanupSteps.push({
        label: "Cleanup: Registered User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: [ctx.registeredUserId] },
      });
    }
    // Delete admin-created test user (batch delete via admin)
    if (ctx.adminCreatedUserId && ctx.adminCreatedUserId !== ctx.registeredUserId) {
      cleanupSteps.push({
        label: "Cleanup: Admin Created User",
        method: "PATCH",
        path: "/api/admin/users/batch/delete",
        jsonBody: { user_ids: [ctx.adminCreatedUserId] },
      });
    }

    for (const step of cleanupSteps) {
      if (signal.aborted) break;
      await waitWithAbort(API_TEST_GAP_MUTATION_MS, signal);
      if (signal.aborted) break;

      const started = performance.now();
      const ranAt = new Date().toISOString();
      try {
        const fetchOpts: RequestInit = {
          method: step.method,
          credentials: "include",
          signal,
        };
        if (step.jsonBody !== undefined) {
          fetchOpts.headers = { "Content-Type": "application/json" };
          fetchOpts.body = JSON.stringify(step.jsonBody);
        }
        const response = await fetch(step.path, fetchOpts);
        const latencyMs = Math.round(performance.now() - started);
        let body = "";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          const raw = await response.text();
          if (raw) body = JSON.stringify(JSON.parse(raw), null, 2);
        } else {
          body = await response.text();
        }
        pushLog({
          id: nextLogId(),
          category: "Cleanup",
          label: step.label,
          method: step.method,
          path: step.path,
          status: response.status,
          latencyMs,
          error: response.ok ? null : `${response.status} ${response.statusText}`,
          body: truncateJson(body),
          ranAt,
        });
      } catch (err) {
        if (signal.aborted) break;
        const latencyMs = Math.round(performance.now() - started);
        pushLog({
          id: nextLogId(),
          category: "Cleanup",
          label: step.label,
          method: step.method,
          path: step.path,
          status: null,
          latencyMs,
          error: err instanceof Error ? err.message : "Unknown error",
          body: "",
          ranAt,
        });
      }
    }
  }, [pushLog]);

  const runAllCategories = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearRunConsole();
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
    setRunningAll(true);
    try {
      for (const cat of API_CATEGORIES) {
        if (controller.signal.aborted) break;
        await runCategoryInternal(cat, controller.signal);
      }
      // Cleanup phase: delete test-created objects
      if (!controller.signal.aborted) {
        await runCleanup(controller.signal);
      }
    } finally {
      setRunningAll(false);
    }
  }, [clearRunConsole, runCategoryInternal, runCleanup]);

  const clearDebug = useCallback(() => {
    setDebugLogs([]);
    setResultMap(new Map());
    contextRef.current = createInitialTestRunContext();
  }, []);

  if (!isAdmin) {
    return (
      <Stack gap={12}>
        {heading}
        <Alert color="yellow" title={t("adminOnly")} />
      </Stack>
    );
  }

  const totalEndpoints = API_CATEGORIES.reduce((sum, cat) => sum + cat.endpoints.length, 0);
  const completedEndpoints = Math.min(resultMap.size, totalEndpoints);
  const progressPercent = totalEndpoints > 0 ? (completedEndpoints / totalEndpoints) * 100 : 0;

  return (
    <Stack gap={16}>
      {heading}

      {/* ── System Health ─────────────────────────── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Group justify="space-between" mb={12}>
              <Text fw={600} size="sm">{t("status.section.health")}</Text>
              <Group gap={6}>
                {statusLatencyMs !== null ? (
                  <Badge size="sm" variant="light" color="gray">{statusLatencyMs}ms</Badge>
                ) : null}
              </Group>
            </Group>
            <AdminSystemSection
              statusLoading={statusLoading}
              statusError={statusError}
              loadErrorMessage={loadErrorMessage}
              statusData={statusData}
            />
          </div>
        </PortalCard>

        <PortalCard interactive={false}>
          <div style={{ padding: "1.2rem" }}>
            <Group justify="space-between" mb={12}>
              <Text fw={600} size="sm">{t("status.healthLogs.title")}</Text>
              <Button
                size="compact-xs"
                variant="light"
                onClick={onCopyConfigSummary}
                disabled={!canCopyConfigSummary}
                leftSection={<IconClipboard size={14} />}
              >
                {t("status.copyConfig")}
              </Button>
            </Group>
            <ScrollArea.Autosize mah={180}>
              <Stack gap={4}>
                {statusHealthLogs.length === 0 ? (
                  <Text c="dimmed" size="sm">{t("status.healthLogs.empty")}</Text>
                ) : (
                  statusHealthLogs.map((row, index) => (
                    <Text key={`${row.at}-${index}`} size="xs" style={{ fontFamily: "monospace" }}>
                      {formatDateTime(row.at)} | DB {row.db} | R2 {row.r2} | WS {row.ws} | Crons {row.crons} | {row.latencyMs ?? "-"}ms
                    </Text>
                  ))
                )}
              </Stack>
            </ScrollArea.Autosize>
          </div>
        </PortalCard>
      </SimpleGrid>

      {/* ── API Test Panels ───────────────────────── */}
      <PortalCard interactive={false}>
        <div style={{ padding: "1.2rem" }}>
          <Group justify="space-between" mb={4}>
            <Group gap={8}>
              <Text fw={600} size="sm">{t("status.section.apiTests")}</Text>
              <Badge size="xs" variant="light" color="gray">{totalEndpoints} endpoints</Badge>
            </Group>
            <ProgressButton
              onPress={runAllCategories}
              loadingLabel={t("status.api.runAll")}
              successLabel={t("status.api.runAll")}
              errorLabel={t("status.api.runAll")}
              indicator="spinner"
              disabled={runningAll}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <IconPlayerPlay size={14} />
                <span>{t("status.api.runAll")}</span>
              </span>
            </ProgressButton>
          </Group>
          <Text c="dimmed" size="xs" mb={12}>{t("status.section.apiTestsHint")}</Text>
          <Accordion variant="separated" multiple>
            {API_CATEGORIES.map((cat) => (
              <Accordion.Item key={cat.key} value={cat.key}>
                <Accordion.Control>
                  <Group gap={8}>
                    <Text fw={500} size="sm">{cat.label}</Text>
                    <Badge size="xs" variant="light" color="gray">
                      {cat.endpoints.length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <ApiTestCategory
                    category={cat}
                    onRunCategory={runCategory}
                    runningSet={runningSet}
                    resultMap={resultMap}
                    runLabel={t("status.api.runCategory")}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
          <Stack gap={6} mt={12}>
            <Group justify="space-between" gap={8}>
              <Text c="dimmed" size="xs">{t("status.api.progress")}</Text>
              <Text c="dimmed" size="xs">{completedEndpoints}/{totalEndpoints}</Text>
            </Group>
            <Progress value={progressPercent} size="sm" radius="xl" striped={runningAll} animated={runningAll} />
          </Stack>
        </div>
      </PortalCard>

      {/* ── Debug Console ─────────────────────────── */}
      <DebugConsole logs={debugLogs} onClear={clearDebug} />
    </Stack>
  );
}
