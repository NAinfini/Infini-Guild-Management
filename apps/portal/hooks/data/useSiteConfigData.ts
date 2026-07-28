import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { fetchAdminSiteConfig } from "../../services/SiteConfigService";

export function useAdminSiteConfigData(enabled: boolean) {
  const adminSiteConfigQuery = useQuery({
    queryKey: queryKeys.siteConfig.admin(),
    queryFn: fetchAdminSiteConfig,
    enabled,
    staleTime: 5 * 60_000,
  });

  return { adminSiteConfigQuery };
}
