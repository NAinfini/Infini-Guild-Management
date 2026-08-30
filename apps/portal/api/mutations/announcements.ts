import {
  type Announcement,
  type AnnouncementAttachmentUploadResponse,
  type AnnouncementImageUploadResponse,
  announcementAttachmentUploadResponseSchema,
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

export function updateAnnouncement(id: string, payload: UpdateAnnouncementPayload, ifMatch: string): Promise<Announcement> {
  const bodyJson = updateAnnouncementSchema.parse(payload);
  return apiRequest<Announcement>(`/api/announcements/${id}`, {
    method: "PATCH",
    bodyJson,
    ifMatch,
  });
}

export function archiveAnnouncement(id: string, ifMatch: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}`, {
    method: "DELETE",
    ifMatch,
  });
}

export function deleteAnnouncement(id: string, ifMatch: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/announcements/${id}/permanent`, {
    method: "DELETE",
    ifMatch,
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

export async function uploadAnnouncementAttachment(
  file: File,
): Promise<AnnouncementAttachmentUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiRequest<AnnouncementAttachmentUploadResponse>(
    "/api/announcements/attachments",
    {
      method: "POST",
      body: formData,
    },
  );
  return announcementAttachmentUploadResponseSchema.parse(response);
}
