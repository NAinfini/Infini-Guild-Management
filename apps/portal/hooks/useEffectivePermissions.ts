import { PERMISSIONS, type AdminRole, type Permission } from "@guild/shared";
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
  const canReadRoles = user?.permissions["admin.roles.view"] === true
    || user?.permissions["admin.roles.manage"] === true;

  const rolesQuery = useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: fetchRoles,
    enabled: canReadRoles,
    staleTime: 5 * 60_000,
  });

  const roles: AdminRole[] = rolesQuery.data ?? [];
  const configuredRole = roles.find((r) => r.id === viewingAs);

  const canManage = (permissions: Permission[]): boolean => {
    if (viewingAs === "external") return false;
    if (viewingAs === user?.role) {
      return permissions.some((permission) => user.permissions[permission] === true);
    }
    if (configuredRole) return permissions.some((p) => configuredRole.permissions[p] === true);
    return false;
  };

  const isModerator = viewingAs !== "external"
    && PERMISSIONS.some((permission) => permission.startsWith("admin.") && canManage([permission]));

  return { viewingAs, isModerator, canManage };
}
