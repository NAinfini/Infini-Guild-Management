import {
  acknowledgeImportantNoticeSchema,
  createImportantNoticeSchema,
  importantNoticeAcknowledgementResponseSchema,
  importantNoticeSchema,
  inboxNotificationMutationResponseSchema,
  markInboxNotificationsReadSchema,
  updateImportantNoticeSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export function markInboxNotificationsRead(input: { ids?: string[]; all?: true }) {
  const bodyJson = markInboxNotificationsReadSchema.parse(input);
  return apiRequest<unknown>("/api/notifications/read", { method: "PATCH", bodyJson })
    .then((response) => inboxNotificationMutationResponseSchema.parse(response));
}

export function acknowledgeImportantNotice(id: string, publicationRevision: number) {
  const bodyJson = acknowledgeImportantNoticeSchema.parse({ publication_revision: publicationRevision });
  return apiRequest<unknown>(`/api/important-notices/${id}/acknowledgement`, { method: "PUT", bodyJson })
    .then((response) => importantNoticeAcknowledgementResponseSchema.parse(response));
}

export type CreateImportantNoticePayload = z.input<typeof createImportantNoticeSchema>;
export type UpdateImportantNoticePayload = z.input<typeof updateImportantNoticeSchema>;

export function createAdminImportantNotice(payload: CreateImportantNoticePayload) {
  return apiRequest<unknown>("/api/admin/important-notices", {
    method: "POST",
    bodyJson: createImportantNoticeSchema.parse(payload),
  }).then((response) => importantNoticeSchema.parse(response));
}

export function updateAdminImportantNotice(id: string, payload: UpdateImportantNoticePayload) {
  return apiRequest<unknown>(`/api/admin/important-notices/${id}`, {
    method: "PATCH",
    bodyJson: updateImportantNoticeSchema.parse(payload),
  }).then((response) => importantNoticeSchema.parse(response));
}

export function publishAdminImportantNotice(id: string) {
  return apiRequest<unknown>(`/api/admin/important-notices/${id}/publish`, { method: "POST" })
    .then((response) => importantNoticeSchema.parse(response));
}

export function withdrawAdminImportantNotice(id: string) {
  return apiRequest<unknown>(`/api/admin/important-notices/${id}/withdraw`, { method: "POST" })
    .then((response) => importantNoticeSchema.parse(response));
}

export function deleteAdminImportantNotice(id: string) {
  return apiRequest<{ ok: true }>(`/api/admin/important-notices/${id}`, { method: "DELETE" });
}
