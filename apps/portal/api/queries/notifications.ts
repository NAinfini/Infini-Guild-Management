import {
  importantNoticeAcknowledgementsResponseSchema,
  importantNoticeActiveResponseSchema,
  importantNoticeSchema,
  inboxNotificationListResponseSchema,
  type InboxNotificationListResponse,
  type ImportantNoticeAcknowledgement,
  type ImportantNoticeActive,
  type ImportantNotice,
} from "@guild/shared";
import { apiRequest } from "../client";

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

export function fetchActiveImportantNotices(): Promise<ImportantNoticeActive[]> {
  return apiRequest<unknown>("/api/important-notices/active")
    .then((response) => importantNoticeActiveResponseSchema.parse(response).data);
}

export function fetchImportantNoticeAcknowledgements(): Promise<ImportantNoticeAcknowledgement[]> {
  return apiRequest<unknown>("/api/important-notices/acknowledgements")
    .then((response) => importantNoticeAcknowledgementsResponseSchema.parse(response).data);
}

export function fetchAdminImportantNotices(): Promise<ImportantNotice[]> {
  return apiRequest<unknown>("/api/admin/important-notices")
    .then((response) => importantNoticeSchema.array().parse(response));
}

export function fetchAdminImportantNotice(id: string): Promise<ImportantNotice> {
  return apiRequest<unknown>(`/api/admin/important-notices/${id}`)
    .then((response) => importantNoticeSchema.parse(response));
}
