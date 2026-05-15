import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog,
  fetchAdminInviteLinks,
  fetchAdminInviteStats,
  fetchAdminStatus,
  fetchRoles,
} from "../../services/AdminService";
import { queryKeys } from "../../api/query-keys";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { canViewStatus, canExportAudit } from "../../utils/permissions";

type UseAdminDataOptions = {
  isModerator: boolean;
  userRole: string;
  auditPage: number;
  auditSearch: string;
  auditDateFrom: string;
  auditDateTo: string;
};

export function useAdminData(options: UseAdminDataOptions) {
  const {
    isModerator,
    userRole,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
  } = options;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: isModerator,
    staleTime: Infinity,
  });

  const roles = rolesQuery.data ?? [];
  const hasStatusViewPermission = canViewStatus(roles, userRole);
  const hasAuditExportPermission = canExportAudit(roles, userRole);

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: isModerator,
    staleTime: 10 * 60_000,
  });

  const inviteLinksQuery = useQuery({
    queryKey: queryKeys.admin.inviteLinks(),
    queryFn: () =>
      fetchAdminInviteLinks({
        include_expired: true,
        include_revoked: true,
      }),
    enabled: isModerator,
    staleTime: 5 * 60_000,
  });

  const inviteStatsQuery = useQuery({
    queryKey: queryKeys.admin.inviteStats(),
    queryFn: fetchAdminInviteStats,
    enabled: isModerator,
    staleTime: 5 * 60_000,
  });

  const auditLogQuery = useQuery({
    queryKey: queryKeys.admin.auditLog(auditPage, auditSearch, auditDateFrom, auditDateTo),
    queryFn: () =>
      fetchAdminAuditLog({
        page: auditPage,
        limit: 50,
        search: auditSearch.trim() || undefined,
        start_at: auditDateFrom ? `${auditDateFrom}T00:00:00.000Z` : undefined,
        end_at: auditDateTo ? `${auditDateTo}T23:59:59.999Z` : undefined,
      }),
    enabled: isModerator,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const auditMonthsQuery = useQuery({
    queryKey: queryKeys.admin.auditMonths(),
    queryFn: fetchAdminAuditArchiveMonths,
    enabled: hasAuditExportPermission,
    staleTime: 10 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.admin.status(),
    queryFn: fetchAdminStatus,
    enabled: hasStatusViewPermission,
    staleTime: 5 * 60_000,
  });

  return {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    auditLogQuery,
    auditMonthsQuery,
    rolesQuery,
    statusQuery,
  };
}
