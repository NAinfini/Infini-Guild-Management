import { useQuery } from "@tanstack/react-query";
import {
  fetchAdminAuditArchiveMonths,
  fetchAdminAuditLog,
  fetchAdminBotSettings,
  fetchAdminDiscordChannels,
  fetchAdminInviteLinks,
  fetchAdminInviteStats,
  fetchAdminStatus,
} from "../../services/AdminService";
import { queryKeys } from "../../services/PortalQueryKeys";
import { fetchRoles } from "../../services/RoleService";
import { fetchUsersList } from "../../services/UserService";
import { canManageBot, canViewStatus, canExportAudit } from "../../utils/permissions";

type UseAdminDataOptions = {
  isModerator: boolean;
  isAdmin: string;
  auditPage: number;
  auditSearch: string;
  auditDateFrom: string;
  auditDateTo: string;
  discordGuildId: string;
};

export function useAdminData(options: UseAdminDataOptions) {
  const {
    isModerator,
    isAdmin: userRole,
    auditPage,
    auditSearch,
    auditDateFrom,
    auditDateTo,
    discordGuildId,
  } = options;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: isModerator,
  });

  const roles = rolesQuery.data ?? [];
  const hasBotManagePermission = canManageBot(roles, userRole);
  const hasStatusViewPermission = canViewStatus(roles, userRole);
  const hasAuditExportPermission = canExportAudit(roles, userRole);

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: fetchUsersList,
    enabled: isModerator,
  });

  const inviteLinksQuery = useQuery({
    queryKey: queryKeys.admin.inviteLinks(),
    queryFn: () =>
      fetchAdminInviteLinks({
        include_expired: true,
        include_revoked: true,
      }),
    enabled: isModerator,
  });

  const inviteStatsQuery = useQuery({
    queryKey: queryKeys.admin.inviteStats(),
    queryFn: fetchAdminInviteStats,
    enabled: isModerator,
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
  });

  const auditMonthsQuery = useQuery({
    queryKey: queryKeys.admin.auditMonths(),
    queryFn: fetchAdminAuditArchiveMonths,
    enabled: hasAuditExportPermission,
  });

  const botSettingsQuery = useQuery({
    queryKey: queryKeys.admin.botSettings(),
    queryFn: fetchAdminBotSettings,
    enabled: hasBotManagePermission,
  });

  const discordChannelsQuery = useQuery({
    queryKey: queryKeys.admin.discordChannels(discordGuildId.trim() || "none"),
    queryFn: () => fetchAdminDiscordChannels(discordGuildId.trim()),
    enabled: hasBotManagePermission && discordGuildId.trim().length > 0,
  });

  const statusQuery = useQuery({
    queryKey: queryKeys.admin.status(),
    queryFn: fetchAdminStatus,
    enabled: hasStatusViewPermission,
  });

  return {
    usersQuery,
    inviteLinksQuery,
    inviteStatsQuery,
    auditLogQuery,
    auditMonthsQuery,
    botSettingsQuery,
    rolesQuery,
    discordChannelsQuery,
    statusQuery,
  };
}
