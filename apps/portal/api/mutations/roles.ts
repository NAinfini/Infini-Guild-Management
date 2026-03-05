import type { AdminRole, Permission } from "@guild/shared";
import { apiRequest } from "../client";

type RolePermissionPatch = Partial<Record<Permission, boolean>>;

export function createRole(payload: {
  id?: string;
  name: string;
  level: number;
  color?: string | null;
  permissions?: RolePermissionPatch;
}): Promise<AdminRole> {
  return apiRequest<AdminRole>("/api/admin/roles", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateRole(
  id: string,
  payload: {
    name?: string;
    level?: number;
    color?: string | null;
    permissions?: RolePermissionPatch;
  },
): Promise<AdminRole> {
  return apiRequest<AdminRole>(`/api/admin/roles/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function deleteRole(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/roles/${id}`, {
    method: "DELETE",
  });
}
