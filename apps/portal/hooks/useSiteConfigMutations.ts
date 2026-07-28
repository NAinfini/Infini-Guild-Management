import type { AdminSiteConfigResponse, UpdateSiteConfigPayload } from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  uploadAdminSiteLogo,
  updateAdminSiteConfig,
} from "../services/SiteConfigService";
import { notifySuccess } from "../utils/notifications";
import { useSiteConfigStore } from "../stores/site-config";

type UseSiteConfigMutationsParams = {
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useSiteConfigMutations({ showError }: UseSiteConfigMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();

  const applySiteConfig = (data: AdminSiteConfigResponse) => {
    useSiteConfigStore.getState().setSiteConfig({
      siteName: data.site.site_name,
      siteLogoUrl: data.site.site_logo_url,
    });
    useSiteConfigStore.getState().setFeatures(data.site.features);
    document.title = data.site.site_name;
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (favicon) favicon.href = data.site.site_logo_url;
    queryClient.setQueryData(queryKeys.siteConfig.admin(), data);
  };

  const invalidateSiteConfig = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.siteConfig.all });
  };

  const updateSiteConfigMutation = useMutation({
    mutationFn: (payload: UpdateSiteConfigPayload) => updateAdminSiteConfig(payload),
    onSuccess: async (data) => {
      applySiteConfig(data);
      notifySuccess(t("siteConfig.message.saved"));
      await invalidateSiteConfig();
    },
    onError: (error) => showError(error, t("siteConfig.message.saveFailed")),
  });

  const uploadSiteLogoMutation = useMutation({
    mutationFn: (file: File) => uploadAdminSiteLogo(file),
    onSuccess: async (data) => {
      applySiteConfig(data);
      notifySuccess(t("siteConfig.message.logoUploaded"));
      await invalidateSiteConfig();
    },
    onError: (error) => showError(error, t("siteConfig.message.logoUploadFailed")),
  });

  return {
    updateSiteConfigMutation,
    uploadSiteLogoMutation,
  };
}
