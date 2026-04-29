import type { Permission } from "@guild/shared";
import { useAuthStore } from "../stores/auth";

export function useHasPermission(permission: Permission): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.permissions[permission] === true;
}

export function useHasAnyPermission(permissions: Permission[]): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return permissions.some((p) => user.permissions[p] === true);
}
