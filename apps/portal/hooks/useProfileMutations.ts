import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import type { UseMediaUploadState } from "./useMediaUpload";
import type { ProfileDraftSnapshot, ProfileFormStateController } from "./useProfileFormState";
import { queryKeys } from "../api/query-keys";
import { logout as requestLogout } from "../services/AuthService";
import {
  changeMyPassword,
  changeMyUsername,
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
} from "../services/UserService";
import { useAuthStore } from "../stores/auth";
import { notifySuccess } from "../utils/notifications";
import { transitionSession } from "../session-transition";

type UseProfileMutationsParams = {
  form: ProfileFormStateController;
  imageUploader: UseMediaUploadState<unknown>;
  audioUploader: UseMediaUploadState<unknown>;
};

export function useProfileMutations({ form, imageUploader, audioUploader }: UseProfileMutationsParams) {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setProfile = useAuthStore((state) => state.setProfile);
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const removingImageIdsRef = useRef(new Set<string>());
  const [removingImageIds, setRemovingImageIds] = useState<ReadonlySet<string>>(new Set());

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Missing user session");
      /* 连同这次送出去的草稿快照一起回传：服务端会规范化字段（称号 HTML 要过
         白名单清洗），acceptServerProfile 靠它区分「该校准」和「用户刚改过、
         不能覆盖」的字段。 */
      const submitted: ProfileDraftSnapshot = {
        bio: form.bio,
        titleHtml: form.titleHtml,
        power: form.power,
        classList: form.classList,
        videoList: form.videoList,
        imageList: form.imageList,
        availabilityData: form.availabilityData,
      };
      const profile = await updateMyProfile(user.id, {
        bio: submitted.bio || null,
        title_html: submitted.titleHtml || null,
        power: submitted.power,
        classes: submitted.classList,
        video_urls: submitted.videoList,
        images: submitted.imageList,
        availability: submitted.availabilityData,
      });
      return { profile, submitted };
    },
    onSuccess: ({ profile: updatedProfile, submitted }) => {
      form.acceptServerProfile(updatedProfile, submitted);
      setProfile(updatedProfile);
      /* PATCH 已经返回了权威资料；后续 refetch 只负责同步缓存，不能继续占用
         saving 状态。CI 上一次慢 GET 因此让保存条多留了 10 秒。 */
      void queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      notifySuccess(t("message.profileSaved"));
    },
    onError: (error) => {
      showError(error, t("message.profileSaveFailed"));
    },
  });

  const removeImageMutation = useMutation({
    mutationFn: (mediaId: string) => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileImage(user.id, mediaId);
    },
    onSuccess: async (_data, mediaId) => {
      form.setImageList((current) => current.filter((item) => item !== mediaId));
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifySuccess(t("message.imageRemoved"));
    },
    onError: (error) => {
      showError(error, t("message.imageRemoveFailed"));
    },
    onSettled: (_data, _error, mediaId) => {
      removingImageIdsRef.current.delete(mediaId);
      setRemovingImageIds(new Set(removingImageIdsRef.current));
    },
  });

  const removeAudioMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileAudio(user.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifySuccess(t("message.audioRemoved"));
    },
    onError: (error) => {
      showError(error, t("message.audioRemoveFailed"));
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return changeMyPassword(user.id, {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmNewPassword: form.confirmNewPassword,
      });
    },
    onSuccess: () => {
      form.setCurrentPassword("");
      form.setNewPassword("");
      form.setConfirmNewPassword("");
      notifySuccess(t("message.passwordChanged"));
      transitionSession(queryClient, null);
      void navigate({ to: "/login", search: { reason: "expired" } });
    },
    onError: (error) => {
      showError(error, t("message.passwordChangeFailed"));
    },
  });

  const changeUsernameMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return changeMyUsername(user.id, {
        currentPassword: form.currentPasswordForUsername,
        newUsername: form.newUsername,
      });
    },
    onSuccess: () => {
      notifySuccess(t("message.usernameChanged"));
      form.setCurrentPasswordForUsername("");
      form.setNewUsername("");
      transitionSession(queryClient, null);
      void navigate({ to: "/login" });
    },
    onError: (error) => {
      showError(error, t("message.usernameChangeFailed"));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSettled: () => {
      transitionSession(queryClient, null);
      void navigate({ to: "/login" });
    },
  });

  const saveProfile = () => {
    if (!user) return;
    saveProfileMutation.mutate();
  };

  const uploadImages = async () => {
    if (!user) return;
    try {
      const uploaded = await imageUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifySuccess(t("message.imagesUploaded"));
    } catch (error) {
      showError(error, t("message.imageUploadFailed"));
    }
  };

  const uploadAudio = async () => {
    if (!user) return;
    try {
      const uploaded = await audioUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifySuccess(t("message.audioUploaded"));
    } catch (error) {
      showError(error, t("message.audioUploadFailed"));
    }
  };

  const removeImage = (mediaId: string) => {
    if (!user || removingImageIdsRef.current.has(mediaId)) return;
    removingImageIdsRef.current.add(mediaId);
    setRemovingImageIds(new Set(removingImageIdsRef.current));
    removeImageMutation.mutate(mediaId);
  };

  const removeAudio = () => {
    if (!user) return;
    removeAudioMutation.mutate();
  };

  const changePassword = () => {
    if (!user) return;
    changePasswordMutation.mutate();
  };

  const changeUsername = () => {
    if (!user) return;
    changeUsernameMutation.mutate();
  };

  const logout = () => {
    logoutMutation.mutate();
  };

  return {
    saveProfileMutation,
    changePasswordMutation,
    changeUsernameMutation,
    saveProfile,
    uploadImages,
    uploadAudio,
    removeImage,
    removingImageIds,
    removeAudio,
    changePassword,
    changeUsername,
    logout,
  };
}
