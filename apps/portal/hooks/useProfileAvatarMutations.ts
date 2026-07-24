import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import { deleteAvatar, uploadAvatar } from "../services/UserService";
import { notifySuccess } from "../utils/notifications";

type UseProfileAvatarMutationsParams = {
  userId?: string;
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useProfileAvatarMutations({ userId, showError }: UseProfileAvatarMutationsParams) {
  const { t } = useTranslation("profile");
  const queryClient = useQueryClient();

  const invalidateProfileImages = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(userId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
  };

  const avatarUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!userId) throw new Error("Missing user session");
      return uploadAvatar(userId, file);
    },
    onSuccess: async () => {
      await invalidateProfileImages();
      notifySuccess(t("message.avatarUploaded"));
    },
    onError: (error) => showError(error, t("message.avatarUploadFailed")),
  });

  const avatarDeleteMutation = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Missing user session");
      return deleteAvatar(userId);
    },
    onSuccess: async () => {
      await invalidateProfileImages();
      notifySuccess(t("message.avatarRemoved"));
    },
    onError: (error) => showError(error, t("message.avatarRemoveFailed")),
  });

  return {
    avatarUploadMutation,
    avatarDeleteMutation,
  };
}
