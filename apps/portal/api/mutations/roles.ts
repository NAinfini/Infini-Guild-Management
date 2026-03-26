import { type AdminRole, createRoleSchema, updateRoleSchema } from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type CreateRolePayload = z.input<typeof createRoleSchema>;
export type UpdateRolePayload = z.input<typeof updateRoleSchema>;

export function createRole(payload: CreateRolePayload): Promise<AdminRole> {
  const bodyJson = createRoleSchema.parse(payload);
  return apiRequest<AdminRole>("/api/admin/roles", {
    method: "POST",
    bodyJson,
  });
}

export function updateRole(id: string, payload: UpdateRolePayload): Promise<AdminRole> {
  const bodyJson = updateRoleSchema.parse(payload);
  return apiRequest<AdminRole>(`/api/admin/roles/${id}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function deleteRole(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/roles/${id}`, {
    method: "DELETE",
  });
}
