import {
  type Announcement,
  type AnnouncementImageUploadResponse,
  announcementImageUploadResponseSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { appendImageUploadVariants, convertImagesForUpload } from "../../utils/upload-media";

export type CreateAnnouncementPayload = z.input<typeof createAnnouncementSchema>;
export type UpdateAnnouncementPayload = z.input<typeof updateAnnouncementSchema>;

export function createAnnouncement(payload: CreateAnnouncementPayload): Promise<Announcement> {
  const bodyJson = createAnnouncementSchema.parse(payload);
  return apiRequest<Announcement>("/api/announcements", {
    method: "POST",
    bodyJson,
  });
}

export function updateAnnouncement(id: string, payload: UpdateAnnouncementPayload, ifMatch?: string): Promise<Announcement> {
  const bodyJson = updateAnnouncementSchema.parse(payload);
  return apiRequest<Announcement>(`/api/announcements/${id}`, {
    method: "PATCH",
    bodyJson,
    ifMatch,
  });
}

export function archiveAnnouncement(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}`, {
    method: "DELETE",
  });
}

export function deleteAnnouncement(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}/permanent`, {
    method: "DELETE",
  });
}

async function buildAnnouncementImageFormData(files: File[]): Promise<FormData> {
  const converted = await convertImagesForUpload(files);
  const formData = new FormData();
  appendImageUploadVariants(formData, converted);
  return formData;
}

export async function uploadPendingAnnouncementImages(
  files: File[],
): Promise<AnnouncementImageUploadResponse> {
  const formData = await buildAnnouncementImageFormData(files);
  const response = await apiRequest<AnnouncementImageUploadResponse>(
    "/api/announcements/images",
    {
      method: "POST",
      body: formData,
    },
  );
  return announcementImageUploadResponseSchema.parse(response);
}

export async function uploadAnnouncementImages(
  announcementId: string,
  files: File[],
): Promise<{ media_ids: string[] }> {
  const formData = await buildAnnouncementImageFormData(files);
  return apiRequest<{ media_ids: string[] }>(`/api/announcements/${announcementId}/images`, {
    method: "POST",
    body: formData,
  });
}
