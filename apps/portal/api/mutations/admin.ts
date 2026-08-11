import {
  type InviteLink,
  type MemberProfile,
  adminUpdateProfileSchema,
  batchDeactivateSchema,
  batchRoleChangeSchema,
  createAdminMemberSchema,
  createInviteLinkSchema,
  resetLoginLockResponseSchema,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type CreateInviteLinkPayload = z.input<typeof createInviteLinkSchema>;
export type CreateAdminMemberPayload = z.input<typeof createAdminMemberSchema>;
export type BatchRoleChangePayload = z.input<typeof batchRoleChangeSchema>;
export type BatchDeactivatePayload = z.input<typeof batchDeactivateSchema>;
export type AdminUpdateProfilePayload = z.input<typeof adminUpdateProfileSchema>;
export type ResetAdminUserLoginLockResponse = z.infer<typeof resetLoginLockResponseSchema>;

export function adminUpdateProfile(userId: string, payload: AdminUpdateProfilePayload): Promise<MemberProfile> {
  const bodyJson = adminUpdateProfileSchema.parse(payload);
  return apiRequest<MemberProfile>(`/api/users/${userId}/profile`, { method: "PATCH", bodyJson });
}

export function createAdminInviteLink(payload: CreateInviteLinkPayload): Promise<InviteLink> {
  const bodyJson = createInviteLinkSchema.parse(payload);
  return apiRequest<InviteLink>("/api/admin/invite-links", { method: "POST", bodyJson });
}

export function revokeAdminInviteLink(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/invite-links/${id}`, {
    method: "DELETE",
  });
}

export function deleteAdminInviteLink(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/invite-links/${id}/permanent`, {
    method: "DELETE",
  });
}

export function updateAdminUserRole(
  userId: string,
  role: string,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    bodyJson: { role },
  });
}

export function deactivateAdminUser(userId: string, reason?: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/deactivate`, {
    method: "PATCH",
    bodyJson: reason !== undefined ? { reason } : {},
  });
}

export function reactivateAdminUser(userId: string, reason?: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/reactivate`, {
    method: "PATCH",
    bodyJson: reason !== undefined ? { reason } : {},
  });
}

export function resetAdminUserPassword(
  userId: string,
  temporary_password?: string,
): Promise<{ ok: true; temporary_password: string }> {
  return apiRequest<{ ok: true; temporary_password: string }>(
    `/api/admin/users/${userId}/reset-password`,
    {
      method: "POST",
      bodyJson: temporary_password !== undefined ? { temporary_password } : {},
    },
  );
}

export function resetAdminUserLoginLock(userId: string): Promise<ResetAdminUserLoginLockResponse> {
  return apiRequest<ResetAdminUserLoginLockResponse>(`/api/admin/users/${userId}/reset-login-lock`, {
    method: "POST",
    bodyJson: {},
  });
}

export function createAdminMember(
  payload: CreateAdminMemberPayload,
): Promise<{ ok: true; user_id: string; username: string; temporary_password: string }> {
  const bodyJson = createAdminMemberSchema.parse(payload);
  return apiRequest<{ ok: true; user_id: string; username: string; temporary_password: string }>(
    "/api/admin/users",
    {
      method: "POST",
      bodyJson,
    },
  );
}

export function batchUpdateAdminUserRole(
  payload: BatchRoleChangePayload,
): Promise<{ ok: true; updated: number }> {
  const bodyJson = batchRoleChangeSchema.parse(payload);
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/role", {
    method: "PATCH",
    bodyJson,
  });
}

export function batchDeactivateAdminUsers(
  payload: BatchDeactivatePayload,
): Promise<{ ok: true; updated: number }> {
  const bodyJson = batchDeactivateSchema.parse(payload);
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/deactivate", {
    method: "PATCH",
    bodyJson,
  });
}

export function batchReactivateAdminUsers(
  payload: BatchDeactivatePayload,
): Promise<{ ok: true; updated: number }> {
  const bodyJson = batchDeactivateSchema.parse(payload);
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/reactivate", {
    method: "PATCH",
    bodyJson,
  });
}

export function batchDeleteAdminUsers(
  payload: BatchDeactivatePayload,
): Promise<{ ok: true; updated: number }> {
  const bodyJson = batchDeactivateSchema.parse(payload);
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/delete", {
    method: "PATCH",
    bodyJson,
  });
}

