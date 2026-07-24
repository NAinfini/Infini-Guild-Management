import type { ImageGridEditorItem } from "@portal/types/media";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaUpload } from "../../../hooks/useMediaUpload";
import { notifySuccess } from "../../../utils/notifications";
import { resolveProfileMediaUrl } from "../../../utils/media";
import {
  deleteAvatar,
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
  uploadAvatar,
  uploadProfileAudio,
  uploadProfileImages,
  type UsersListResponse,
} from "../../../services/UserService";

const PROFILE_IMAGE_MAX = 10;
const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

type AdminUserRow = UsersListResponse["data"][number];

type UseAdminMemberMediaControllerParams = {
  member: AdminUserRow | null;
  onRefresh: () => Promise<void>;
  onError: (error: unknown, fallbackMessage: string) => void;
};

function requireMember(member: AdminUserRow | null): AdminUserRow {
  if (!member) {
    throw new Error("Missing member");
  }
  return member;
}

export function useAdminMemberMediaController({
  member,
  onRefresh,
  onError,
}: UseAdminMemberMediaControllerParams) {
  const { t } = useTranslation(["admin", "common"]);
  const memberVideoUrls = member?.profile.video_urls ?? [];
  const memberVideoUrlsSnapshot = JSON.stringify(memberVideoUrls);

  const imageItems: ImageGridEditorItem[] = useMemo(
    () =>
      (member?.profile.images ?? []).map((key) => ({
        id: key,
        src: resolveProfileMediaUrl(key),
        alt: key,
      })),
    [member?.profile.images],
  );

  const imageUploader = useMediaUpload(
    async (files) => uploadProfileImages(requireMember(member).user.id, files),
    {
      maxFiles: PROFILE_IMAGE_MAX,
      maxFileSizeBytes: PROFILE_IMAGE_MAX_BYTES,
      mediaType: "image",
      convertImagesToWebp: true,
      imageWebpQuality: 0.8,
    },
  );

  const audioUploader = useMediaUpload(
    async (files) => {
      const file = files[0];
      if (!file) {
        throw new Error(t("media.audioFileRequired"));
      }
      return uploadProfileAudio(requireMember(member).user.id, file);
    },
    {
      maxFiles: 1,
      maxFileSizeBytes: PROFILE_AUDIO_MAX_BYTES,
      mediaType: "audio",
      convertAudioToOpus: false,
    },
  );

  const deleteImageMutation = useMutation({
    mutationFn: (key: string) => deleteProfileImage(requireMember(member).user.id, key),
    onSuccess: async () => {
      notifySuccess(t("message.mediaImageRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageRemoveFailed")),
  });

  const reorderImagesMutation = useMutation({
    mutationFn: (newOrder: string[]) =>
      updateMyProfile(requireMember(member).user.id, { images: newOrder }),
    onSuccess: async () => {
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageReorderFailed")),
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => deleteProfileAudio(requireMember(member).user.id),
    onSuccess: async () => {
      notifySuccess(t("message.mediaAudioRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAudioRemoveFailed")),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => uploadAvatar(requireMember(member).user.id, file),
    onSuccess: async () => {
      notifySuccess(t("message.mediaAvatarUploaded"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAvatarUploadFailed")),
  });

  const deleteAvatarMutation = useMutation({
    mutationFn: () => deleteAvatar(requireMember(member).user.id),
    onSuccess: async () => {
      notifySuccess(t("message.mediaAvatarRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAvatarRemoveFailed")),
  });

  const [videoUrls, setVideoUrls] = useState<string[]>(() => [...memberVideoUrls]);

  useEffect(() => {
    setVideoUrls([...(member?.profile.video_urls ?? [])]);
  }, [member?.user.id, memberVideoUrlsSnapshot]);

  const saveVideosMutation = useMutation({
    mutationFn: (urls: string[]) =>
      updateMyProfile(requireMember(member).user.id, {
        video_urls: urls.filter((url) => url.trim() !== ""),
      }),
    onSuccess: async () => {
      notifySuccess(t("message.mediaVideosSaved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaVideosSaveFailed")),
  });

  const changeVideoUrl = useCallback((index: number, value: string) => {
    setVideoUrls((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }, []);

  const addVideoUrl = useCallback(() => {
    setVideoUrls((current) => (current.length >= 10 ? current : [...current, ""]));
  }, []);

  const removeVideoUrl = useCallback((index: number) => {
    setVideoUrls((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const hasVideoChanges = useMemo(
    () => JSON.stringify(videoUrls) !== memberVideoUrlsSnapshot,
    [memberVideoUrlsSnapshot, videoUrls],
  );

  const saveVideoUrls = useCallback(
    async () => {
      await saveVideosMutation.mutateAsync(videoUrls);
    },
    [saveVideosMutation, videoUrls],
  );

  const reorderImages = useCallback(
    (items: ImageGridEditorItem[]) => {
      reorderImagesMutation.mutate(items.map((item) => item.id));
    },
    [reorderImagesMutation],
  );

  const deleteImage = useCallback(
    (item: ImageGridEditorItem) => {
      deleteImageMutation.mutate(item.id);
    },
    [deleteImageMutation],
  );

  const uploadImages = useCallback(async () => {
    try {
      const result = await imageUploader.upload();
      if (!result) {
        return;
      }
      notifySuccess(t("message.mediaImagesUploaded"));
      await onRefresh();
      imageUploader.reset();
    } catch (error) {
      onError(error, t("message.mediaImagesUploadFailed"));
    }
  }, [imageUploader, onError, onRefresh, t]);

  const uploadAudio = useCallback(async () => {
    try {
      const result = await audioUploader.upload();
      if (!result) {
        return;
      }
      notifySuccess(t("message.mediaAudioUploaded"));
      await onRefresh();
      audioUploader.reset();
    } catch (error) {
      onError(error, t("message.mediaAudioUploadFailed"));
    }
  }, [audioUploader, onError, onRefresh, t]);

  const deleteAudio = useCallback(() => {
    deleteAudioMutation.mutate();
  }, [deleteAudioMutation]);

  const handleUploadAvatar = useCallback(
    (file: File) => {
      uploadAvatarMutation.mutate(file);
    },
    [uploadAvatarMutation],
  );

  const handleDeleteAvatar = useCallback(() => {
    deleteAvatarMutation.mutate();
  }, [deleteAvatarMutation]);

  return {
    imageItems,
    imageUploader,
    imageReorderPending: reorderImagesMutation.isPending,
    imageDeletePending: deleteImageMutation.isPending,
    reorderImages,
    deleteImage,
    uploadImages,
    videoUrls,
    hasVideoChanges,
    saveVideosPending: saveVideosMutation.isPending,
    changeVideoUrl,
    addVideoUrl,
    removeVideoUrl,
    saveVideoUrls,
    audioUploader,
    deleteAudioPending: deleteAudioMutation.isPending,
    uploadAudio,
    deleteAudio,
    uploadAvatar: handleUploadAvatar,
    deleteAvatar: handleDeleteAvatar,
    avatarUploadPending: uploadAvatarMutation.isPending,
    avatarDeletePending: deleteAvatarMutation.isPending,
  };
}
