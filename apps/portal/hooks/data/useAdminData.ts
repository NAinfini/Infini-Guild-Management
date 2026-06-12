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
import { getAdminCapabilities } from "../../utils/permissions";
import { fetchAdminSiteConfig } from "../../services/SiteConfigService";
import type { AdminCapabilities } from "../../utils/permissions";

type UseAdminDataOptions = {
  isModerator: boolean;
  userRole: string;
  effectivePermissions?: AdminCapabilities;
  auditPage: number;
  auditSearch: string;
  auditDateFrom: string;
  auditDateTo: string;
  auditEntityType: string;
  auditActorId: string;
};

export function useAdminData(options: UseAdminDataOptions) {
  const {
    isModerator,
    userRole,
    effectivePermissions,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    auditEntityType,
    auditActorId,
  } = options;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: isModerator,
    staleTime: Infinity,
  });

  const roles = rolesQuery.data ?? [];
  const rolePermissions = getAdminCapabilities(roles, userRole);
  const permissions = rolesQuery.isSuccess ? rolePermissions : effectivePermissions ?? rolePermissions;

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: permissions.canViewUsers,
    staleTime: 10 * 60_000,
  });

  const inviteLinksQuery = useQuery({
    queryKey: queryKeys.admin.inviteLinks(),
    queryFn: () =>
      fetchAdminInviteLinks({
        include_expired: true,
        include_revoked: true,
      }),
    enabled: permissions.canViewInvites,
    staleTime: 5 * 60_000,
  });

  const inviteStatsQuery = useQuery({
    queryKey: queryKeys.admin.inviteStats(),
    queryFn: fetchAdminInviteStats,
    enabled: permissions.canViewInvites,
    staleTime: 5 * 60_000,
  });

  const auditLogQuery = useQuery({
    queryKey: queryKeys.admin.auditLog(auditPage, auditSearch, auditDateFrom, auditDateTo, auditEntityType || undefined, auditActorId || undefined),
    queryFn: () =>
      fetchAdminAuditLog({
        page: auditPage,
        limit: 50,
        search: auditSearch.trim() || undefined,
        start_at: auditDateFrom ? `${auditDateFrom}T00:00:00.000Z` : undefined,
        end_at: auditDateTo ? `${auditDateTo}T23:59:59.999Z` : undefined,
        entity_type: auditEntityType || undefined,
        actor_id: auditActorId || undefined,
      }),
    enabled: permissions.canViewAudit,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const auditMonthsQuery = useQuery({
    queryKey: queryKeys.admin.auditMonths(),
    queryFn: fetchAdminAuditArchiveMonths,
    enabled: permissions.canExportAudit,
    staleTime: 10 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.admin.status(),
    queryFn: fetchAdminStatus,
    enabled: permissions.canViewStatus,
    staleTime: 5 * 60_000,
  });

  const siteConfigQuery = useQuery({
    queryKey: queryKeys.siteConfig.admin(),
    queryFn: fetchAdminSiteConfig,
    enabled: permissions.canManageSiteConfig,
    staleTime: 5 * 60_000,
  });

  return {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    auditLogQuery,
    auditMonthsQuery,
    rolesQuery,
    siteConfigQuery,
    statusQuery,
    permissions,
  };
}
