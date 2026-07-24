import type { AdminRole, Permission } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-keys";
import { useViewingAs } from "../context/ViewingAsContext";
import { fetchRoles } from "../services/AdminService";
import { useAuthStore } from "../stores/auth";

export function useEffectiveRole(): string {
  return useViewingAs();
}

export function useEffectivePermissions(): {
  viewingAs: string;
  isModerator: boolean;
  canManage: (permissions: Permission[]) => boolean;
} {
  const viewingAs = useViewingAs();
  const user = useAuthStore((s) => s.user);

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const roles: AdminRole[] = rolesQuery.data ?? [];
  const configuredRole = roles.find((r) => r.id === viewingAs);
  const canUseSessionPermissions = Boolean(user) && viewingAs === user?.role && !configuredRole;

  const canManage = (permissions: Permission[]): boolean => {
    if (viewingAs === "external") return false;
    if (configuredRole) return permissions.some((p) => configuredRole.permissions[p] === true);
    if (canUseSessionPermissions) return permissions.some((p) => user?.permissions[p] === true);
    return false;
  };

  const isModerator = viewingAs !== "external" && [
      "admin.users.view",
      "admin.invite.view",
      "admin.audit.view",
      "admin.status.view",
      "admin.analytics.view",
      "admin.siteConfig.manage",
      "admin.badges.manage",
      "admin.storage.structure",
      "admin.storage.items",
      "admin.storage.stock",
      "admin.roles.manage",
    ].some((permission) => canManage([permission as Permission]));

  return { viewingAs, isModerator, canManage };
}
