import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserDetailResponse } from "@guild/shared";
import { useAppError } from "./useAppError";
import type { UseMediaUploadState } from "./useMediaUpload";
import type { ProfileDraftSnapshot, ProfileFormStateController } from "./useProfileFormState";
import { queryKeys } from "../api/query-keys";
import { logout as requestLogout } from "../services/AuthService";
import {
  deleteProfileAudio,
  deleteProfileImage,
  updateOwnProfile,
} from "../services/UserService";
import type { ProfileAudioUploadResult, ProfileImageUploadResult } from "../services/UserService";
import { useAuthStore } from "../stores/auth";
import { notifySuccess } from "../utils/notifications";
import { captureSessionRequest, logoutSession } from "../session-transition";

type UseProfileMutationsParams = {
  form: ProfileFormStateController;
  imageUploader: UseMediaUploadState<ProfileImageUploadResult>;
  audioUploader: UseMediaUploadState<ProfileAudioUploadResult>;
};

export function useProfileMutations({ form, imageUploader, audioUploader }: UseProfileMutationsParams) {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { showError } = useAppError();
  const removingImageIdsRef = useRef(new Set<string>());
  const [removingImageIds, setRemovingImageIds] = useState<ReadonlySet<string>>(new Set());

  const saveProfileMutation = useMutation({
    onMutate: () => captureSessionRequest(),
    mutationFn: async () => {
      if (!user) throw new Error("Missing user session");
      if (!form.profileRevisionToken) throw new Error("Missing profile revision token");
      /* 连同这次送出去的草稿快照一起回传：服务端会规范化字段（称号 HTML 要过
         白名单清洗），acceptServerProfile 靠它区分「该校准」和「用户刚改过、
         不能覆盖」的字段。 */
      const submitted: ProfileDraftSnapshot = {
        displayName: form.displayName,
        bio: form.bio,
        titleHtml: form.titleHtml,
        power: form.power,
        classList: form.classList,
        videoList: form.videoList,
        imageList: form.imageList,
        availabilityData: form.availabilityData,
      };
      const { profile, profileRevisionToken } = await updateOwnProfile(user.id, {
        display_name: submitted.displayName,
        bio: submitted.bio || null,
        title_html: submitted.titleHtml || null,
        power: submitted.power,
        classes: submitted.classList,
        video_urls: submitted.videoList,
        images: submitted.imageList,
        availability: submitted.availabilityData,
      }, form.profileRevisionToken);
      return { profile, submitted, profileRevisionToken };
    },
    onSuccess: ({ profile: updatedProfile, submitted, profileRevisionToken }, _variables, request) => {
      if (!request?.isCurrent()) return;
      form.acceptServerProfile(updatedProfile, submitted.displayName, submitted, profileRevisionToken);
      const current = useAuthStore.getState();
      if (current.user && current.sessionScope) {
        current.setSession({ ...current.user, display_name: submitted.displayName }, updatedProfile, current.sessionScope);
      }
      queryClient.setQueryData<UserDetailResponse>(queryKeys.myProfile.detail(user?.id), (current) => (
        current
          ? {
              ...current,
              user: { ...current.user, display_name: submitted.displayName },
              profile: updatedProfile,
              edit_revisions: current.edit_revisions
                ? {
                    ...current.edit_revisions,
                    profile_revision_token: profileRevisionToken,
                  }
                : current.edit_revisions,
            }
          : current
      ));
      /* PATCH 已经返回了权威资料；后续 refetch 只负责同步缓存，不能继续占用
         saving 状态。CI 上一次慢 GET 因此让保存条多留了 10 秒。 */
      void queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      notifySuccess(t("message.profileSaved"));
    },
    onError: (error, _variables, request) => {
      if (!request?.isCurrent()) return;
      showError(error, t("message.profileSaveFailed"));
    },
  });

  const removeImageMutation = useMutation({
    mutationFn: (mediaId: string) => {
      if (!user) throw new Error("Missing user session");
      if (!form.profileRevisionToken) throw new Error("Missing profile revision token");
      return deleteProfileImage(user.id, mediaId, form.profileRevisionToken);
    },
    onSuccess: async (result, mediaId) => {
      form.acceptOwnImageRemoval(mediaId, result.profileRevisionToken);
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
      if (!form.profileRevisionToken) throw new Error("Missing profile revision token");
      return deleteProfileAudio(user.id, form.profileRevisionToken);
    },
    onSuccess: async (result) => {
      form.acceptOwnMediaRevision(result.profileRevisionToken);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifySuccess(t("message.audioRemoved"));
    },
    onError: (error) => {
      showError(error, t("message.audioRemoveFailed"));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: (_reason?: "expired") => logoutSession(queryClient, requestLogout),
    onMutate: (reason) => {
      void navigate({
        to: "/login",
        search: reason === "expired" ? { reason } : {},
      });
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
      form.acceptOwnImageUpload(uploaded.media_ids, uploaded.profileRevisionToken);
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
      form.acceptOwnMediaRevision(uploaded.profileRevisionToken);
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

  const logout = (reason?: "expired") => {
    logoutMutation.mutate(reason);
  };

  return {
    saveProfileMutation,
    saveProfile,
    uploadImages,
    uploadAudio,
    removeImage,
    removingImageIds,
    removeAudio,
    logout,
  };
}
