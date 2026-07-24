import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { fetchAdminSiteConfig, fetchMemberOnboarding } from "../../services/SiteConfigService";

export function useAdminSiteConfigData(enabled: boolean) {
  const adminSiteConfigQuery = useQuery({
    queryKey: queryKeys.siteConfig.admin(),
    queryFn: fetchAdminSiteConfig,
    enabled,
    staleTime: 5 * 60_000,
  });

  return { adminSiteConfigQuery };
}

export function useMemberOnboardingData(enabled: boolean) {
  const onboardingQuery = useQuery({
    queryKey: queryKeys.onboarding.me(),
    queryFn: fetchMemberOnboarding,
    enabled,
    staleTime: 5 * 60_000,
  });

  return { onboardingQuery };
}
