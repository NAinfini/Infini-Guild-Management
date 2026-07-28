import {
  type Announcement,
  type AnnouncementImageStagingResponse,
  announcementImageStagingResponseSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { convertFilesForUpload } from "@guild/shared/utils/media";

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
  const converted = await convertFilesForUpload(files);
  const formData = new FormData();
  for (const file of converted) {
    formData.append("files", file);
  }
  return formData;
}

export async function stageAnnouncementImages(
  stagingToken: string | null,
  files: File[],
): Promise<AnnouncementImageStagingResponse> {
  const formData = await buildAnnouncementImageFormData(files);
  if (stagingToken) {
    formData.set("staging_token", stagingToken);
  }
  const response = await apiRequest<AnnouncementImageStagingResponse>(
    "/api/announcements/images/stage",
    {
      method: "POST",
      body: formData,
    },
  );
  return announcementImageStagingResponseSchema.parse(response);
}

export async function uploadAnnouncementImages(
  announcementId: string,
  files: File[],
): Promise<{ keys: string[] }> {
  const formData = await buildAnnouncementImageFormData(files);
  return apiRequest<{ keys: string[] }>(`/api/announcements/${announcementId}/images`, {
    method: "POST",
    body: formData,
  });
}
