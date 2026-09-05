import {
  importantNoticeActiveResponseSchema,
  importantNoticeAudienceRolesResponseSchema,
  importantNoticeSchema,
  inboxNotificationListResponseSchema,
  inboxNotificationUnreadCountResponseSchema,
  notificationPreferencesSchema,
  type InboxNotificationListResponse,
  type InboxNotificationUnreadCountResponse,
  type ImportantNoticeActive,
  type ImportantNoticeAudienceRole,
  type ImportantNotice,
  type NotificationPreferences,
} from "@guild/shared";
import { apiRequest } from "../client";

export function fetchInboxUnreadCount(): Promise<InboxNotificationUnreadCountResponse> {
  return apiRequest<unknown>("/api/notifications/unread-count")
    .then((response) => inboxNotificationUnreadCountResponseSchema.parse(response));
}

export function fetchInboxNotifications(params: {
  limit?: number;
  cursor?: string | null;
}): Promise<InboxNotificationListResponse> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 20),
  });
  if (params.cursor) query.set("cursor", params.cursor);
  return apiRequest<unknown>(`/api/notifications?${query.toString()}`)
    .then((response) => inboxNotificationListResponseSchema.parse(response));
}

export function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return apiRequest<unknown>("/api/notifications/preferences")
    .then((response) => notificationPreferencesSchema.parse(response));
}

export function fetchActiveImportantNotices(): Promise<ImportantNoticeActive[]> {
  return apiRequest<unknown>("/api/important-notices/active")
    .then((response) => importantNoticeActiveResponseSchema.parse(response).data);
}

export function fetchAdminImportantNotices(): Promise<ImportantNotice[]> {
  return apiRequest<unknown>("/api/admin/important-notices")
    .then((response) => importantNoticeSchema.array().parse(response));
}

export function fetchImportantNoticeAudienceRoles(): Promise<ImportantNoticeAudienceRole[]> {
  return apiRequest<unknown>("/api/admin/important-notices/audience-roles")
    .then((response) => importantNoticeAudienceRolesResponseSchema.parse(response).data);
}

export function fetchAdminImportantNotice(id: string): Promise<ImportantNotice> {
  return apiRequest<unknown>(`/api/admin/important-notices/${id}`)
    .then((response) => importantNoticeSchema.parse(response));
}
