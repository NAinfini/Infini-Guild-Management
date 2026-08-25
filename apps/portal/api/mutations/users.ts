import {
  createMemberAbsenceSchema,
  deleteProfileImagesSchema,
  updateProfileSchema,
  type CreateMemberAbsencePayload,
  type MemberAbsence,
  type MemberProfile,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import {
  appendImageUploadVariants,
  convertImageForUpload,
  convertImagesForUpload,
} from "../../utils/upload-media";

export type UpdateMyProfilePayload = z.input<typeof updateProfileSchema>;

export function updateMyProfile(userId: string, payload: UpdateMyProfilePayload): Promise<MemberProfile> {
  const bodyJson = updateProfileSchema.parse(payload);
  return apiRequest<MemberProfile>(`/api/users/${userId}/profile`, {
    method: "PATCH",
    bodyJson,
  });
}

export async function uploadProfileImages(userId: string, files: File[]): Promise<{ media_ids: string[] }> {
  const converted = await convertImagesForUpload(files);
  const formData = new FormData();
  appendImageUploadVariants(formData, converted);

  return apiRequest<{ media_ids: string[] }>(`/api/users/${userId}/media/images`, {
    method: "POST",
    body: formData,
  });
}

/** Uploads the canonical Ogg/Opus file produced by useMediaUpload's audio preprocessing. */
export async function uploadProfileAudio(userId: string, canonicalAudioFile: File): Promise<{ media_id: string }> {
  const formData = new FormData();
  formData.append("file", canonicalAudioFile);

  return apiRequest<{ media_id: string }>(`/api/users/${userId}/media/audio`, {
    method: "POST",
    body: formData,
  });
}

export async function uploadAvatar(userId: string, file: File): Promise<{ media_id: string }> {
  const converted = await convertImageForUpload(file);
  const formData = new FormData();
  appendImageUploadVariants(formData, [converted]);

  return apiRequest<{ media_id: string }>(`/api/users/${userId}/media/avatar`, {
    method: "POST",
    body: formData,
  });
}

export function deleteAvatar(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/media/avatar`, {
    method: "DELETE",
  });
}

export function deleteProfileImage(userId: string, mediaId: string): Promise<{ ok: true }> {
  return deleteProfileImages(userId, [mediaId]).then(() => ({ ok: true as const }));
}

export function deleteProfileImages(userId: string, mediaIds: string[]): Promise<{ ok: true; deleted: number }> {
  const bodyJson = deleteProfileImagesSchema.parse({ media_ids: mediaIds });
  return apiRequest<{ ok: true; deleted: number }>(`/api/users/${userId}/media/images`, {
    method: "DELETE",
    bodyJson,
  });
}

export function deleteProfileAudio(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/media/audio`, {
    method: "DELETE",
  });
}

export function createMemberAbsence(userId: string, payload: CreateMemberAbsencePayload): Promise<MemberAbsence> {
  const bodyJson = createMemberAbsenceSchema.parse(payload);
  return apiRequest<MemberAbsence>(`/api/users/${userId}/absences`, {
    method: "POST",
    bodyJson,
  });
}

export function deleteMemberAbsence(userId: string, absenceId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/absences/${absenceId}`, {
    method: "DELETE",
  });
}
