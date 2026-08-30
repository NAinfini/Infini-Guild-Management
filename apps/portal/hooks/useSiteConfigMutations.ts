import type { AdminSiteConfigResponse, UpdateSiteConfigPayload } from "@guild/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import {
  uploadAdminSiteLogo,
  updateAdminSiteConfig,
} from "../services/SiteConfigService";
import { notifySuccess } from "../utils/notifications";
import { applyPublicSiteConfig } from "../stores/site-config";

type UseSiteConfigMutationsParams = {
  showError: (error: unknown, fallbackMessage: string) => void;
};

export function useSiteConfigMutations({ showError }: UseSiteConfigMutationsParams) {
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();

  const applySiteConfig = (data: AdminSiteConfigResponse) => {
    applyPublicSiteConfig(data.site);
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
    mutationFn: ({ file, expectedRevisionToken }: { file: File; expectedRevisionToken: string }) =>
      uploadAdminSiteLogo(file, expectedRevisionToken),
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
