import type {
  AdminSiteConfigResponse,
  PublicSiteConfig,
  UpdateSiteConfigPayload,
} from "@guild/shared";
import { convertFileForUpload } from "@guild/shared/utils/media";
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
  /*
   * 站点标志和别的上传走同一条转码入口。
   * 这是全站每一页都要拉的一张图，原来却是唯一一条把原始文件直接塞进 R2 的路径。
   */
  const converted = await convertFileForUpload(file);
  const formData = new FormData();
  formData.set("file", converted);
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config/logo", {
    method: "POST",
    body: formData,
  });
}
