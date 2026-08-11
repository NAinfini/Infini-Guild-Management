import type {
  AdminSiteConfigResponse,
  PublicSiteConfig,
  UpdateSiteConfigPayload,
} from "@guild/shared";
import { appendImageUploadVariants, convertImageForUpload } from "../utils/upload-media";
import { apiRequest } from "../api/client";

export function fetchPublicSiteConfig(): Promise<PublicSiteConfig & { features?: Record<string, boolean> }> {
  return apiRequest<PublicSiteConfig & { features?: Record<string, boolean> }>("/api/site-config");
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

export async function uploadAdminSiteLogo(file: File): Promise<AdminSiteConfigResponse> {
  const converted = await convertImageForUpload(file);
  const formData = new FormData();
  appendImageUploadVariants(formData, [converted]);
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config/logo", {
    method: "POST",
    body: formData,
  });
}
