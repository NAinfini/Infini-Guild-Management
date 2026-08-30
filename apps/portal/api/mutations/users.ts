import {
  createMemberAbsenceSchema,
  deleteMemberProfileImagesResponseSchema,
  deleteMemberProfileMediaResponseSchema,
  deleteProfileImagesSchema,
  memberProfileRevisionEtag,
  updateMemberProfileResponseSchema,
  updateProfileSchema,
  uploadMemberProfileImagesResponseSchema,
  uploadMemberProfileMediaResponseSchema,
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
export type UpdateOwnProfileResult = Readonly<{
  profile: MemberProfile;
  profileRevisionToken: string;
}>;
export type ProfileImageUploadResult = Readonly<{
  media_ids: string[];
  profileRevisionToken: string;
}>;
export type ProfileAudioUploadResult = Readonly<{
  media_id: string;
  profileRevisionToken: string;
}>;
export type ProfileAvatarUploadResult = ProfileAudioUploadResult;
export type ProfileMediaDeleteResult = Readonly<{
  ok: true;
  profileRevisionToken: string;
}>;
export type ProfileImagesDeleteResult = ProfileMediaDeleteResult & Readonly<{ deleted: number }>;

export function updateMyProfile(
  userId: string,
  payload: UpdateMyProfilePayload,
  profileRevisionToken: string,
): Promise<UpdateOwnProfileResult> {
  return updateProfileWithRevision(userId, payload, profileRevisionToken);
}

export function updateOwnProfile(
  userId: string,
  payload: UpdateMyProfilePayload,
  profileRevisionToken: string,
): Promise<UpdateOwnProfileResult> {
  return updateProfileWithRevision(userId, payload, profileRevisionToken);
}

async function updateProfileWithRevision(
  userId: string,
  payload: UpdateMyProfilePayload,
  profileRevisionToken: string,
): Promise<UpdateOwnProfileResult> {
  const bodyJson = updateProfileSchema.parse(payload);
  const { profile_revision_token: nextProfileRevisionToken, ...profile } = updateMemberProfileResponseSchema.parse(await apiRequest<unknown>(`/api/users/${userId}/profile`, {
    method: "PATCH",
    bodyJson,
    ifMatch: memberProfileRevisionEtag(profileRevisionToken),
  }));
  return { profile, profileRevisionToken: nextProfileRevisionToken };
}

export async function uploadProfileImages(
  userId: string,
  files: File[],
  profileRevisionToken: string,
): Promise<ProfileImageUploadResult> {
  const converted = await convertImagesForUpload(files);
  const formData = new FormData();
  appendImageUploadVariants(formData, converted);

  const result = await requestProfileMedia(
    `/api/users/${userId}/media/images`,
    profileRevisionToken,
    { method: "POST", body: formData },
    uploadMemberProfileImagesResponseSchema,
  );
  return { media_ids: result.media_ids, profileRevisionToken: result.profile_revision_token };
}

/** Uploads the canonical Ogg/Opus file produced by useMediaUpload's audio preprocessing. */
export async function uploadProfileAudio(
  userId: string,
  canonicalAudioFile: File,
  profileRevisionToken: string,
): Promise<ProfileAudioUploadResult> {
  const formData = new FormData();
  formData.append("file", canonicalAudioFile);

  const result = await requestProfileMedia(
    `/api/users/${userId}/media/audio`,
    profileRevisionToken,
    { method: "POST", body: formData },
    uploadMemberProfileMediaResponseSchema,
  );
  return { media_id: result.media_id, profileRevisionToken: result.profile_revision_token };
}

export async function uploadAvatar(
  userId: string,
  file: File,
  profileRevisionToken: string,
): Promise<ProfileAvatarUploadResult> {
  const converted = await convertImageForUpload(file);
  const formData = new FormData();
  appendImageUploadVariants(formData, [converted]);

  const result = await requestProfileMedia(
    `/api/users/${userId}/media/avatar`,
    profileRevisionToken,
    { method: "POST", body: formData },
    uploadMemberProfileMediaResponseSchema,
  );
  return { media_id: result.media_id, profileRevisionToken: result.profile_revision_token };
}

export async function deleteAvatar(userId: string, profileRevisionToken: string): Promise<ProfileMediaDeleteResult> {
  const result = await requestProfileMedia(
    `/api/users/${userId}/media/avatar`,
    profileRevisionToken,
    { method: "DELETE" },
    deleteMemberProfileMediaResponseSchema,
  );
  return { ok: result.ok, profileRevisionToken: result.profile_revision_token };
}

export function deleteProfileImage(
  userId: string,
  mediaId: string,
  profileRevisionToken: string,
): Promise<ProfileMediaDeleteResult> {
  return deleteProfileImages(userId, [mediaId], profileRevisionToken).then(({ profileRevisionToken: nextProfileRevisionToken }) => ({
    ok: true as const,
    profileRevisionToken: nextProfileRevisionToken,
  }));
}

export async function deleteProfileImages(
  userId: string,
  mediaIds: string[],
  profileRevisionToken: string,
): Promise<ProfileImagesDeleteResult> {
  const bodyJson = deleteProfileImagesSchema.parse({ media_ids: mediaIds });
  const result = await requestProfileMedia(
    `/api/users/${userId}/media/images`,
    profileRevisionToken,
    { method: "DELETE", bodyJson },
    deleteMemberProfileImagesResponseSchema,
  );
  return {
    ok: result.ok,
    deleted: result.deleted,
    profileRevisionToken: result.profile_revision_token,
  };
}

export async function deleteProfileAudio(userId: string, profileRevisionToken: string): Promise<ProfileMediaDeleteResult> {
  const result = await requestProfileMedia(
    `/api/users/${userId}/media/audio`,
    profileRevisionToken,
    { method: "DELETE" },
    deleteMemberProfileMediaResponseSchema,
  );
  return { ok: result.ok, profileRevisionToken: result.profile_revision_token };
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

async function requestProfileMedia<TSchema extends z.ZodType>(
  path: string,
  profileRevisionToken: string,
  init: RequestInit & { bodyJson?: Record<string, unknown> },
  responseSchema: TSchema,
): Promise<z.output<TSchema>> {
  return responseSchema.parse(await apiRequest<unknown>(path, {
    ...init,
    ifMatch: memberProfileRevisionEtag(profileRevisionToken),
  }));
}
