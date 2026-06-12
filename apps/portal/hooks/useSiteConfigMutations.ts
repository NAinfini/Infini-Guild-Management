import type { UpdateMemberOnboardingPayload, UpdateOnboardingConfigPayload, UpdateSiteConfigPayload } from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  acknowledgeOnboarding,
  uploadAdminSiteLogo,
  updateAdminOnboardingConfig,
  updateAdminSiteConfig,
  updateMemberOnboarding,
} from "../services/SiteConfigService";
import { notifySuccess } from "../utils/notifications";

type UseSiteConfigMutationsParams = {
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useSiteConfigMutations({ showError }: UseSiteConfigMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();

  const invalidateSiteConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.siteConfig.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
  };

  const updateSiteConfigMutation = useMutation({
    mutationFn: (payload: UpdateSiteConfigPayload & { onboarding?: UpdateOnboardingConfigPayload }) =>
      updateAdminSiteConfig(payload),
    onSuccess: async () => {
      notifySuccess(t("siteConfig.message.saved"));
      await invalidateSiteConfig();
    },
    onError: (error) => showError(error, t("siteConfig.message.saveFailed")),
  });

  const uploadSiteLogoMutation = useMutation({
    mutationFn: (file: File) => uploadAdminSiteLogo(file),
    onSuccess: async () => {
      notifySuccess(t("siteConfig.message.logoUploaded"));
      await invalidateSiteConfig();
    },
    onError: (error) => showError(error, t("siteConfig.message.logoUploadFailed")),
  });

  const updateOnboardingMutation = useMutation({
    mutationFn: (payload: UpdateOnboardingConfigPayload) => updateAdminOnboardingConfig(payload),
    onSuccess: async () => {
      notifySuccess(t("siteConfig.message.onboardingSaved"));
      await invalidateSiteConfig();
    },
    onError: (error) => showError(error, t("siteConfig.message.onboardingSaveFailed")),
  });

  return {
    updateSiteConfigMutation,
    uploadSiteLogoMutation,
    updateOnboardingMutation,
  };
}

type UseMemberOnboardingMutationsParams = {
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useMemberOnboardingMutations({ showError }: UseMemberOnboardingMutationsParams) {
  const { t } = useTranslation("profile");
  const queryClient = useQueryClient();

  const updateOnboardingProgressMutation = useMutation({
    mutationFn: (payload: UpdateMemberOnboardingPayload) => updateMemberOnboarding(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
    },
    onError: (error) => showError(error, t("onboarding.message.progressFailed")),
  });

  const acknowledgeOnboardingMutation = useMutation({
    mutationFn: acknowledgeOnboarding,
    onSuccess: async () => {
      notifySuccess(t("onboarding.message.acknowledged"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
    },
    onError: (error) => showError(error, t("onboarding.message.ackFailed")),
  });

  return {
    updateOnboardingProgressMutation,
    acknowledgeOnboardingMutation,
  };
}
