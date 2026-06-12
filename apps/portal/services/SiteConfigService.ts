import type {
  AdminSiteConfigResponse,
  MemberOnboardingResponse,
  PublicSiteConfig,
  UpdateMemberOnboardingPayload,
  UpdateOnboardingConfigPayload,
  UpdateSiteConfigPayload,
} from "@guild/shared";
import { ApiRequestError, apiRequest } from "../api/client";

export function fetchPublicSiteConfig(): Promise<PublicSiteConfig & { features?: Record<string, boolean> }> {
  return apiRequest<PublicSiteConfig & { features?: Record<string, boolean> }>("/api/site-config");
}

export function fetchAdminSiteConfig(): Promise<AdminSiteConfigResponse> {
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config");
}

export function updateAdminSiteConfig(payload: UpdateSiteConfigPayload & { onboarding?: UpdateOnboardingConfigPayload }): Promise<AdminSiteConfigResponse> {
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config", {
    method: "PATCH",
    bodyJson: payload as Record<string, unknown>,
  });
}

export function uploadAdminSiteLogo(file: File): Promise<AdminSiteConfigResponse> {
  const formData = new FormData();
  formData.set("file", file);
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config/logo", {
    method: "POST",
    body: formData,
  });
}

export function updateAdminOnboardingConfig(payload: UpdateOnboardingConfigPayload): Promise<AdminSiteConfigResponse> {
  return apiRequest<AdminSiteConfigResponse>("/api/admin/site-config/onboarding", {
    method: "PATCH",
    bodyJson: payload as Record<string, unknown>,
  });
}

export async function fetchMemberOnboarding(): Promise<MemberOnboardingResponse | null> {
  try {
    return await apiRequest<MemberOnboardingResponse>("/api/onboarding");
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404 && error.errorCode === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export function updateMemberOnboarding(payload: UpdateMemberOnboardingPayload): Promise<MemberOnboardingResponse> {
  return apiRequest<MemberOnboardingResponse>("/api/onboarding/me", {
    method: "PATCH",
    bodyJson: payload as Record<string, unknown>,
  });
}

export function acknowledgeOnboarding(): Promise<MemberOnboardingResponse> {
  return apiRequest<MemberOnboardingResponse>("/api/onboarding/acknowledge", {
    method: "POST",
  });
}
