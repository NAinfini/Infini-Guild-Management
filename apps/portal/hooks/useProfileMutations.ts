import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import type { UseMediaUploadState } from "./useMediaUpload";
import type { ProfileFormStateController } from "./useProfileFormState";
import { logout as requestLogout } from "../services/AuthService";
import { queryKeys } from "../services/PortalQueryKeys";
import {
  changeMyPassword,
  changeMyUsername,
  deleteProfileAudio,
  deleteProfileImage,
  unlinkMyDiscord,
  updateMyProfile,
  verifyMyDiscordLink,
} from "../services/UserService";
import { useAuthStore } from "../stores/auth";

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
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Missing user session");
      return updateMyProfile(user.id, {
        bio: form.bio || null,
        title_html: form.titleHtml || null,
        wechat_name: form.wechatName || null,
        power: form.power,
        classes: form.classList,
        video_urls: form.videoList,
        images: form.imageList,
        vacation_start: form.vacationStart || null,
        vacation_end: form.vacationEnd || null,
        availability: form.availabilityData,
        discord_reminder_opt_out: form.discordReminderOptOut,
      });
    },
    onSuccess: async (updatedProfile) => {
      setProfile(updatedProfile);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.profileSaved") });
    },
    onError: (error) => {
      showError(error, t("message.profileSaveFailed"));
    },
  });

  const removeImageMutation = useMutation({
    mutationFn: (key: string) => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileImage(user.id, key);
    },
    onSuccess: async (_data, key) => {
      form.setImageList((current) => current.filter((item) => item !== key));
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.imageRemoved") });
    },
    onError: (error) => {
      showError(error, t("message.imageRemoveFailed"));
    },
  });

  const removeAudioMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileAudio(user.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.audioRemoved") });
    },
    onError: (error) => {
      showError(error, t("message.audioRemoveFailed"));
    },
  });

  const verifyDiscordMutation = useMutation({
    mutationFn: () => {
      if (!user || !form.discordCode.trim()) throw new Error("Missing user or code");
      return verifyMyDiscordLink(user.id, { code: form.discordCode.trim() });
    },
    onMutate: () => {
      form.setIsDiscordLinking(true);
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      form.setDiscordCode("");
      notifications.show({ color: "infini-success", message: t("message.discordLinked", { discordId: response.discord_id }) });
    },
    onError: (error) => {
      showError(error, t("message.discordLinkFailed"));
    },
    onSettled: () => {
      form.setIsDiscordLinking(false);
    },
  });

  const unlinkDiscordMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return unlinkMyDiscord(user.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      notifications.show({ color: "infini-success", message: t("message.discordUnlinked") });
    },
    onError: (error) => {
      showError(error, t("message.discordUnlinkFailed"));
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
      notifications.show({ color: "infini-success", message: t("message.passwordChanged") });
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
      notifications.show({ color: "infini-success", message: t("message.usernameChanged") });
      form.setCurrentPasswordForUsername("");
      form.setNewUsername("");
      clearSession();
      void navigate({ to: "/login" });
    },
    onError: (error) => {
      showError(error, t("message.usernameChangeFailed"));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: requestLogout,
    onSettled: () => {
      clearSession();
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
      notifications.show({ color: "infini-success", message: t("message.imagesUploaded") });
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
      notifications.show({ color: "infini-success", message: t("message.audioUploaded") });
    } catch (error) {
      showError(error, t("message.audioUploadFailed"));
    }
  };

  const removeImage = (key: string) => {
    if (!user) return;
    removeImageMutation.mutate(key);
  };

  const removeAudio = () => {
    if (!user) return;
    removeAudioMutation.mutate();
  };

  const verifyDiscordLink = () => {
    if (!user || !form.discordCode.trim()) return;
    verifyDiscordMutation.mutate();
  };

  const unlinkDiscord = () => {
    if (!user) return;
    unlinkDiscordMutation.mutate();
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
    removeAudio,
    verifyDiscordLink,
    unlinkDiscord,
    changePassword,
    changeUsername,
    logout,
  };
}
