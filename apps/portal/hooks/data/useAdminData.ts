import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LIMITS } from "@guild/shared/config/limits";
import {
  fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog,
  fetchAdminInviteLinks,
  fetchAdminInviteStats,
  fetchAdminOperations,
  fetchAdminStatus,
  fetchRoles,
} from "../../services/AdminService";
import { queryKeys } from "../../api/query-keys";
import { fetchAllUsersListWithOptions } from "../../services/UserService";
import { getAdminCapabilities } from "../../utils/permissions";
import { fetchAdminSiteConfig } from "../../services/SiteConfigService";
import type { AdminCapabilities } from "../../utils/permissions";
import type { InviteVisibility } from "../../services/AdminService";
import { localDayEndIso, localDayStartIso } from "../../utils/datetime";
import { useAuthStore } from "../../stores/auth";
import { viewerIdentity } from "../../session-storage";

type UseAdminDataOptions = {
  isModerator: boolean;
  userRole: string;
  activeTab: string;
  effectivePermissions?: AdminCapabilities;
  canReadRoleMetadata?: boolean;
  auditSearch: string;
  auditDateFrom: string;
  auditDateTo: string;
  auditEntityType: string;
  auditEntityId: string;
  auditActorId: string;
  inviteVisibility: InviteVisibility;
  inviteSearch: string;
};

export function useAdminData(options: UseAdminDataOptions) {
  const viewerKey = useAuthStore((state) => viewerIdentity(state.user?.id));
  const {
    isModerator,
    userRole,
    activeTab,
    effectivePermissions,
    canReadRoleMetadata,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    auditEntityType,
    auditEntityId,
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
  const needsUsers = activeTab === "member" || activeTab === "badges";
  const normalizedAuditSearch = auditSearch.trim();

  const usersQuery = useQuery({
    queryKey: queryKeys.users.directory(viewerKey, "internal"),
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

  const auditLogQuery = useInfiniteQuery({
    queryKey: queryKeys.admin.auditLog(normalizedAuditSearch, auditDateFrom, auditDateTo, auditEntityType || undefined, auditEntityId || undefined, auditActorId || undefined),
    queryFn: ({ pageParam }) =>
      fetchAdminAuditLog({
        cursor: pageParam,
        limit: 50,
        search: normalizedAuditSearch || undefined,
        start_at: localDayStartIso(auditDateFrom),
        end_at: localDayEndIso(auditDateTo),
        entity_type: auditEntityType || undefined,
        entity_id: auditEntityId || undefined,
        actor_id: auditActorId || undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: permissions.canViewAudit && activeTab === "audit",
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
    enabled: permissions.canViewStatus && activeTab === "operations",
    staleTime: 5 * 60_000,
  });

  const operationsQuery = useQuery({
    queryKey: queryKeys.admin.operations(),
    queryFn: fetchAdminOperations,
    enabled: permissions.canViewStatus && activeTab === "operations",
    staleTime: 30_000,
    refetchInterval: activeTab === "operations" ? 30_000 : false,
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
    operationsQuery,
    auditLogQuery,
    auditMonthsQuery,
    rolesQuery,
    siteConfigQuery,
    statusQuery,
    permissions,
  };
}
