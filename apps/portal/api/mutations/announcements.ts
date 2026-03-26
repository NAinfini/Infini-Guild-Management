import {
  type Announcement,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type CreateAnnouncementPayload = z.input<typeof createAnnouncementSchema>;
export type UpdateAnnouncementPayload = z.input<typeof updateAnnouncementSchema>;

export function createAnnouncement(payload: CreateAnnouncementPayload): Promise<Announcement> {
  const bodyJson = createAnnouncementSchema.parse(payload);
  return apiRequest<Announcement>("/api/announcements", {
    method: "POST",
    bodyJson,
  });
}

export function updateAnnouncement(id: string, payload: UpdateAnnouncementPayload): Promise<Announcement> {
  const bodyJson = updateAnnouncementSchema.parse(payload);
  return apiRequest<Announcement>(`/api/announcements/${id}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function archiveAnnouncement(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}`, {
    method: "DELETE",
  });
}

export function uploadAnnouncementImages(
  announcementId: string,
  files: File[],
): Promise<{ keys: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return apiRequest<{ keys: string[] }>(`/api/announcements/${announcementId}/images`, {
    method: "POST",
    body: formData,
  });
}
