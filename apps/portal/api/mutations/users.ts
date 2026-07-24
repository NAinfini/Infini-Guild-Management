import {
  changePasswordSchema,
  changeUsernameSchema,
  createMemberAbsenceSchema,
  deleteProfileImagesSchema,
  updateProfileSchema,
  type CreateMemberAbsencePayload,
  type MemberAbsence,
  type MemberProfile,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";
import { convertAudioToOpus, convertImageToWebP } from "../../utils/media-convert";

export type UpdateMyProfilePayload = z.input<typeof updateProfileSchema>;
export type ChangeMyPasswordPayload = z.input<typeof changePasswordSchema>;
export type ChangeMyUsernamePayload = z.input<typeof changeUsernameSchema>;

export function updateMyProfile(userId: string, payload: UpdateMyProfilePayload): Promise<MemberProfile> {
  const bodyJson = updateProfileSchema.parse(payload);
  return apiRequest<MemberProfile>(`/api/users/${userId}/profile`, {
    method: "PATCH",
    bodyJson,
  });
}

export async function uploadProfileImages(userId: string, files: File[]): Promise<{ keys: string[] }> {
  const converted = await Promise.all(files.map(convertImageToWebP));
  const formData = new FormData();
  for (const file of converted) {
    formData.append("files", file);
  }

  return apiRequest<{ keys: string[] }>(`/api/users/${userId}/media/images`, {
    method: "POST",
    body: formData,
  });
}

export async function uploadProfileAudio(userId: string, file: File): Promise<{ key: string }> {
  const converted = await convertAudioToOpus(file);
  const formData = new FormData();
  formData.append("file", converted);

  return apiRequest<{ key: string }>(`/api/users/${userId}/media/audio`, {
    method: "POST",
    body: formData,
  });
}

export async function uploadAvatar(userId: string, file: File): Promise<{ key: string }> {
  const converted = await convertImageToWebP(file);
  const formData = new FormData();
  formData.append("file", converted);

  return apiRequest<{ key: string }>(`/api/users/${userId}/media/avatar`, {
    method: "POST",
    body: formData,
  });
}

export function deleteAvatar(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/media/avatar`, {
    method: "DELETE",
  });
}

export function deleteProfileImage(userId: string, key: string): Promise<{ ok: true }> {
  return deleteProfileImages(userId, [key]).then(() => ({ ok: true as const }));
}

export function deleteProfileImages(userId: string, keys: string[]): Promise<{ ok: true; deleted: number }> {
  const bodyJson = deleteProfileImagesSchema.parse({ keys });
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

export function changeMyPassword(
  userId: string,
  payload: ChangeMyPasswordPayload,
): Promise<{ ok: true }> {
  const bodyJson = changePasswordSchema.parse(payload);
  return apiRequest<{ ok: true }>(`/api/users/${userId}/change-password`, {
    method: "POST",
    bodyJson,
  });
}

export function changeMyUsername(
  userId: string,
  payload: ChangeMyUsernamePayload,
): Promise<{ ok: true }> {
  const bodyJson = changeUsernameSchema.parse(payload);
  return apiRequest<{ ok: true }>(`/api/users/${userId}/change-username`, {
    method: "POST",
    bodyJson,
  });
}
