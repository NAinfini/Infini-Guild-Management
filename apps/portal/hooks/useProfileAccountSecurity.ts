import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-keys";
import { getAccountSecurity } from "../services/AuthService";

export function useProfileAccountSecurity() {
  const queryClient = useQueryClient();
  const securityQuery = useQuery({
    queryKey: queryKeys.auth.security(),
    queryFn: getAccountSecurity,
  });

  return {
    securityQuery,
    invalidateSecurity: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.security() }),
    invalidateUsers: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  };
}
