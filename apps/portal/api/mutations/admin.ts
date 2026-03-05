import type { BotSettings, InviteLink } from "@guild/shared";
import { apiRequest } from "../client";

export function createAdminInviteLink(payload: {
  max_uses: number;
  expires_at?: string;
}): Promise<InviteLink> {
  return apiRequest<InviteLink>("/api/admin/invite-links", {
    method: "POST",
    bodyJson: payload,
  });
}

export function revokeAdminInviteLink(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/invite-links/${id}`, {
    method: "DELETE",
  });
}

export function updateAdminUserRole(
  userId: string,
  role: "admin" | "moderator" | "member",
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    bodyJson: { role },
  });
}

export function deactivateAdminUser(userId: string, reason?: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/deactivate`, {
    method: "PATCH",
    bodyJson: { reason },
  });
}

export function reactivateAdminUser(userId: string, reason?: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/admin/users/${userId}/reactivate`, {
    method: "PATCH",
    bodyJson: { reason },
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
      bodyJson: { temporary_password },
    },
  );
}

export function createAdminMember(payload: {
  username: string;
}): Promise<{ ok: true; user_id: string; username: string; temporary_password: string }> {
  return apiRequest<{ ok: true; user_id: string; username: string; temporary_password: string }>(
    "/api/admin/users",
    {
      method: "POST",
      bodyJson: payload,
    },
  );
}

export function batchUpdateAdminUserRole(payload: {
  user_ids: string[];
  new_role: "member" | "moderator";
}): Promise<{ ok: true; updated: number }> {
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/role", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function batchDeactivateAdminUsers(payload: {
  user_ids: string[];
}): Promise<{ ok: true; updated: number }> {
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/deactivate", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function batchReactivateAdminUsers(payload: {
  user_ids: string[];
}): Promise<{ ok: true; updated: number }> {
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/reactivate", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function batchDeleteAdminUsers(payload: {
  user_ids: string[];
}): Promise<{ ok: true; updated: number }> {
  return apiRequest<{ ok: true; updated: number }>("/api/admin/users/batch/delete", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function updateAdminBotSettings(payload: BotSettings): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/admin/bot-settings", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function testAdminBotDispatch(payload: { platform: "discord" | "wechat" }): Promise<{ ok: true; task_id: string }> {
  return apiRequest<{ ok: true; task_id: string }>("/api/admin/bot-settings/test", {
    method: "POST",
    bodyJson: payload,
  });
}

export type AnalyticsSettingsPayload = {
  reference_duration_minutes?: number;
  modifier_weight_kda?: number;
  modifier_weight_towers?: number;
  modifier_weight_credits?: number;
  modifier_weight_distance?: number;
  modifier_weight_basehp?: number;
};

export function updateAnalyticsSettings(
  payload: AnalyticsSettingsPayload,
): Promise<AnalyticsSettingsPayload> {
  return apiRequest<AnalyticsSettingsPayload>("/api/admin/analytics-settings", {
    method: "PATCH",
    bodyJson: payload,
  });
}
