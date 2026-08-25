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
import { resolveMediaUrl } from "../utils/media";

type UseSiteConfigMutationsParams = {
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useSiteConfigMutations({ showError }: UseSiteConfigMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();

  const applySiteConfig = (data: AdminSiteConfigResponse) => {
    const siteLogoUrl = data.site.site_logo_media_id
      ? resolveMediaUrl(data.site.site_logo_media_id)
      : data.site.default_site_logo_url;
    useSiteConfigStore.getState().setSiteConfig({
      siteName: data.site.site_name,
      siteDescription: data.site.site_description,
      siteLogoUrl,
      mediaPolicy: data.site.media_policy,
      oauth: data.site.oauth,
    });
    useSiteConfigStore.getState().setFeatures(data.site.features);
    document.title = data.site.site_name;
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (favicon) favicon.href = siteLogoUrl;
    queryClient.setQueryData(queryKeys.siteConfig.admin(), data);
  };

  const updateSiteConfigMutation = useMutation({
    mutationFn: (payload: UpdateSiteConfigPayload) => updateAdminSiteConfig(payload),
    onSuccess: (data) => {
      applySiteConfig(data);
      notifySuccess(t("siteConfig.message.saved"));
    },
    onError: (error) => showError(error, t("siteConfig.message.saveFailed")),
  });

  const uploadSiteLogoMutation = useMutation({
    mutationFn: (file: File) => uploadAdminSiteLogo(file),
    onSuccess: (data) => {
      applySiteConfig(data);
      notifySuccess(t("siteConfig.message.logoUploaded"));
    },
    onError: (error) => showError(error, t("siteConfig.message.logoUploadFailed")),
  });

  return {
    updateSiteConfigMutation,
    uploadSiteLogoMutation,
  };
}
