import type { MemberProfile } from "@guild/shared";
import { apiRequest } from "../client";

export function updateMyProfile(userId: string, payload: Record<string, unknown>): Promise<MemberProfile> {
  return apiRequest<MemberProfile>(`/api/users/${userId}/profile`, {
    method: "PATCH",
    bodyJson: payload,
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

export function changeMyPassword(userId: string, payload: {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/change-password`, {
    method: "POST",
    bodyJson: payload,
  });
}

export function changeMyUsername(userId: string, payload: {
  currentPassword: string;
  newUsername: string;
}): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/change-username`, {
    method: "POST",
    bodyJson: payload,
  });
}

export function verifyMyDiscordLink(userId: string, payload: {
  code: string;
}): Promise<{ ok: true; discord_id: string }> {
  return apiRequest<{ ok: true; discord_id: string }>(`/api/users/${userId}/discord-link/verify`, {
    method: "POST",
    bodyJson: payload,
  });
}

export function unlinkMyDiscord(userId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/users/${userId}/discord-link`, {
    method: "DELETE",
  });
}
