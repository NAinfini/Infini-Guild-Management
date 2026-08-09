import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LIMITS } from "@guild/shared/config/limits";
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
import type { InviteVisibility } from "../../services/AdminService";

type UseAdminDataOptions = {
  isModerator: boolean;
  userRole: string;
  activeTab: string;
  effectivePermissions?: AdminCapabilities;
  canReadRoleMetadata?: boolean;
  auditPage: number;
  auditSearch: string;
  auditDateFrom: string;
  auditDateTo: string;
  auditEntityType: string;
  auditActorId: string;
  inviteVisibility: InviteVisibility;
  inviteSearch: string;
};

export function useAdminData(options: UseAdminDataOptions) {
  const {
    isModerator,
    userRole,
    activeTab,
    effectivePermissions,
    canReadRoleMetadata,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    auditEntityType,
    auditActorId,
    inviteVisibility,
    inviteSearch,
  } = options;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: canReadRoleMetadata ?? effectivePermissions?.canViewRoles ?? isModerator,
    staleTime: Infinity,
  });

  const roles = rolesQuery.data ?? [];
  const rolePermissions = getAdminCapabilities(roles, userRole);
  const permissions = effectivePermissions ?? rolePermissions;
  const needsUsers =
    activeTab === "member" || activeTab === "audit" || activeTab === "badges";
  const normalizedAuditSearch = auditSearch.trim();

  const usersQuery = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: () => fetchAllUsersListWithOptions(),
    enabled: permissions.canViewUsers && needsUsers,
    staleTime: 10 * 60_000,
  });

  const inviteLinksQuery = useInfiniteQuery({
    queryKey: queryKeys.admin.inviteLinks(inviteVisibility, inviteSearch),
    queryFn: ({ pageParam }) =>
      fetchAdminInviteLinks({
        cursor: pageParam,
        limit: LIMITS.pagination.admin,
        visibility: inviteVisibility,
        search: inviteSearch || undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: permissions.canViewInvites && activeTab === "invite",
    staleTime: 5 * 60_000,
  });

  const inviteStatsQuery = useQuery({
    queryKey: queryKeys.admin.inviteStats(),
    queryFn: fetchAdminInviteStats,
    enabled: permissions.canViewInvites && activeTab === "invite",
    staleTime: 5 * 60_000,
  });

  const auditLogQuery = useQuery({
    queryKey: queryKeys.admin.auditLog(auditPage, normalizedAuditSearch, auditDateFrom, auditDateTo, auditEntityType || undefined, auditActorId || undefined),
    queryFn: () =>
      fetchAdminAuditLog({
        page: auditPage,
        limit: 50,
        search: normalizedAuditSearch || undefined,
        start_at: auditDateFrom ? `${auditDateFrom}T00:00:00.000Z` : undefined,
        end_at: auditDateTo ? `${auditDateTo}T23:59:59.999Z` : undefined,
        entity_type: auditEntityType || undefined,
        actor_id: auditActorId || undefined,
      }),
    enabled: permissions.canViewAudit && activeTab === "audit",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const auditMonthsQuery = useQuery({
    queryKey: queryKeys.admin.auditMonths(),
    queryFn: fetchAdminAuditArchiveMonths,
    enabled: permissions.canExportAudit && activeTab === "audit",
    staleTime: 10 * 60_000,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.admin.status(),
    queryFn: fetchAdminStatus,
    enabled: permissions.canViewStatus && activeTab === "status",
    staleTime: 5 * 60_000,
  });

  const siteConfigQuery = useQuery({
    queryKey: queryKeys.siteConfig.admin(),
    queryFn: fetchAdminSiteConfig,
    enabled: permissions.canManageSiteConfig && activeTab === "siteConfig",
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
