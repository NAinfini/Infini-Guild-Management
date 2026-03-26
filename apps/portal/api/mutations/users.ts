import {
  changePasswordSchema,
  changeUsernameSchema,
  discordLinkVerifySchema,
  updateProfileSchema,
  type MemberProfile,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type UpdateMyProfilePayload = z.input<typeof updateProfileSchema>;
export type ChangeMyPasswordPayload = z.input<typeof changePasswordSchema>;
export type ChangeMyUsernamePayload = z.input<typeof changeUsernameSchema>;
export type VerifyMyDiscordLinkPayload = z.input<typeof discordLinkVerifySchema>;

export function updateMyProfile(userId: string, payload: UpdateMyProfilePayload): Promise<MemberProfile> {
  const bodyJson = updateProfileSchema.parse(payload);
  return apiRequest<MemberProfile>(`/api/users/${userId}/profile`, {
    method: "PATCH",
    bodyJson,
  });
}

export function uploadProfileImages(userId: string, files: File[]): Promise<{ keys: string[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  return apiRequest<{ keys: string[] }>(`/api/users/${userId}/media/images`, {
    method: "POST",
    body: formData,
  });
}

export function uploadProfileAudio(userId: string, file: File): Promise<{ key: string }> {
  const formData = new FormData();
  formData.append("file", file);

  return apiRequest<{ key: string }>(`/api/users/${userId}/media/audio`, {
    method: "POST",
    body: formData,
  });
}

export function deleteProfileImage(userId: string, key: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/media/images/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

export function deleteProfileAudio(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/media/audio`, {
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

export function verifyMyDiscordLink(
  userId: string,
  payload: VerifyMyDiscordLinkPayload,
): Promise<{ ok: true; discord_id: string }> {
  const bodyJson = discordLinkVerifySchema.parse(payload);
  return apiRequest<{ ok: true; discord_id: string }>(`/api/users/${userId}/discord-link/verify`, {
    method: "POST",
    bodyJson,
  });
}

export function unlinkMyDiscord(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/discord-link`, {
    method: "DELETE",
  });
}
