import type { AdminRole, Permission } from "@guild/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchRoles } from "../api/queries/roles";
import { queryKeys } from "../api/query-keys";
import { useViewingAs } from "../context/ViewingAsContext";
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
    staleTime: Infinity,
  });

  const roles: AdminRole[] = rolesQuery.data ?? [];

  const canManage = (permissions: Permission[]): boolean => {
    if (viewingAs === "external") return false;
    const role = roles.find((r) => r.id === viewingAs);
    if (!role) return false;
    return permissions.some((p) => role.permissions[p] === true);
  };

  const isModerator = viewingAs !== "external" && roles.some(
    (r) => r.id === viewingAs && [
      "admin.users.view",
      "admin.invite.view",
      "admin.audit.view",
      "admin.status.view",
      "admin.roles.manage",
    ].some((p) => (r.permissions as Record<string, boolean>)[p] === true),
  );

  return { viewingAs, isModerator, canManage };
}
