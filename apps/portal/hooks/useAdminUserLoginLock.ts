import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-keys";
import { fetchAdminUserLoginLock } from "../services/AdminService";

export function useAdminUserLoginLock(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.loginLock(userId),
    queryFn: () => fetchAdminUserLoginLock(userId!),
    enabled: enabled && userId !== null,
  });
}
