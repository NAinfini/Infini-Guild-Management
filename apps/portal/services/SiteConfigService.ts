import type {
  AdminSiteConfigResponse,
  PublicSiteConfig,
  SiteAnalyticsSettings,
  UpdateSiteConfigPayload,
} from "@guild/shared";
import { publicSiteConfigSchema } from "@guild/shared";
import { appendImageUploadVariants, convertImageForUpload } from "../utils/upload-media";
import { apiRequest } from "../api/client";

export async function fetchPublicSiteConfig(): Promise<PublicSiteConfig> {
  return publicSiteConfigSchema.parse(await apiRequest<unknown>("/api/site-config"));
}

export function fetchAdminSiteConfig(): Promise<AdminSiteConfigResponse> {
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config");
}

export function updateAdminSiteConfig(payload: UpdateSiteConfigPayload): Promise<AdminSiteConfigResponse> {
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config", {
    method: "PATCH",
    bodyJson: payload as Record<string, unknown>,
  });
}

export function updateAdminAnalyticsSettings(
  payload: Readonly<{
    reference_duration_minutes?: number;
    modifier_weights?: Partial<SiteAnalyticsSettings["modifier_weights"]>;
  }>,
): Promise<SiteAnalyticsSettings> {
  return apiRequest<SiteAnalyticsSettings>("/api/admin/analytics-settings", {
    method: "PATCH",
    bodyJson: payload as Record<string, unknown>,
  });
}

export async function uploadAdminSiteLogo(file: File, expectedRevisionToken: string): Promise<AdminSiteConfigResponse> {
  const converted = await convertImageForUpload(file);
  const formData = new FormData();
  appendImageUploadVariants(formData, [converted]);
  formData.append("expected_revision_token", expectedRevisionToken);
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config/logo", {
    method: "POST",
    body: formData,
  });
}
