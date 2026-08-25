import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_SITE_MEDIA_POLICY,
  DEFAULT_SITE_OAUTH_SETTINGS,
  DEFAULT_SITE_STORAGE_POLICY,
  type AdminSiteConfigResponse,
} from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useSiteConfigStore } from "../stores/site-config";
import { useSiteConfigMutations } from "./useSiteConfigMutations";

const apiMocks = vi.hoisted(() => ({
  update: vi.fn(),
  uploadLogo: vi.fn(),
}));

vi.mock("../services/SiteConfigService", () => ({
  updateAdminSiteConfig: apiMocks.update,
  uploadAdminSiteLogo: apiMocks.uploadLogo,
}));

vi.mock("../utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function response(siteName: string, logoId: string | null): AdminSiteConfigResponse {
  return {
    site: {
      site_name: siteName,
      site_description: "A focused home for our guild.",
      site_logo_media_id: logoId,
      default_site_logo_url: "/guild-logo.svg",
      features: DEFAULT_FEATURE_FLAGS,
      oauth: DEFAULT_SITE_OAUTH_SETTINGS,
      media_policy: DEFAULT_SITE_MEDIA_POLICY,
      storage_policy: DEFAULT_SITE_STORAGE_POLICY,
      absence_policy: { max_span_days: 366, max_entries_per_user: 20 },
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-12T00:00:00.000Z",
    },
    oauth_provider_status: {
      google: "missing_credentials",
      discord: "available",
      kook: "missing_credentials",
      wechat: "unsupported",
    },
  };
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSiteConfigMutations", () => {
  beforeEach(() => {
    apiMocks.update.mockReset();
    apiMocks.uploadLogo.mockReset();
  });

  it("keeps each canonical mutation response without invalidating the admin query", async () => {
    const updated = response("Infini Prime", null);
    const withLogo = response("Infini Prime", "logo1234567890abcdefg");
    apiMocks.update.mockResolvedValue(updated);
    apiMocks.uploadLogo.mockResolvedValue(withLogo);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useSiteConfigMutations({ showError: vi.fn() }),
      { wrapper: wrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateSiteConfigMutation.mutateAsync({ site_name: "Infini Prime" });
    });
    expect(queryClient.getQueryData(queryKeys.siteConfig.admin())).toEqual(updated);

    await act(async () => {
      await result.current.uploadSiteLogoMutation.mutateAsync(
        new File(["logo"], "logo.webp", { type: "image/webp" }),
      );
    });
    expect(queryClient.getQueryData(queryKeys.siteConfig.admin())).toEqual(withLogo);
    expect(useSiteConfigStore.getState().siteName).toBe("Infini Prime");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
