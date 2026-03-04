import type { WarHistory, WarTeamMember, WarTemplate } from "@guild/shared";
import { apiRequest } from "../client";

type SaveTeamsPayload = {
  event_id: string;
  teams: Array<{
    team_name: string;
    sort_order: number;
    notes?: string;
    is_locked?: boolean;
    members: Array<{
      user_id: string;
      role_tag?: string;
      sort_order: number;
    }>;
  }>;
  pool_members: Array<{ user_id: string }>;
};

export function saveGuildWarTeams(payload: SaveTeamsPayload): Promise<WarHistory> {
  return apiRequest<WarHistory>("/api/guild-war/save-teams", {
    method: "POST",
    bodyJson: payload,
  });
}

export function moveGuildWarMember(payload: {
  event_id: string;
  user_id: string;
  to: string;
  etag?: string;
}): Promise<{ ok: true }> {
  const { etag, ...body } = payload;
  return apiRequest<{ ok: true }>("/api/guild-war/move", {
    method: "POST",
    ifMatch: etag,
    bodyJson: body,
  });
}

export function updateGuildWarRoleTag(payload: {
  event_id: string;
  user_id: string;
  role_tag: string | null;
}): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/api/guild-war/role-tag", {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function postGuildWarTeams(payload: {
  event_id: string;
  platform: "discord" | "wechat";
}): Promise<{ ok: true; task_id: string }> {
  return apiRequest<{ ok: true; task_id: string }>("/api/guild-war/post-teams", {
    method: "POST",
    bodyJson: payload,
  });
}

export function postGuildWarResults(payload: {
  war_history_id: string;
  platform: "discord" | "wechat";
}): Promise<{ ok: true; task_id: string }> {
  return apiRequest<{ ok: true; task_id: string }>("/api/guild-war/post-results", {
    method: "POST",
    bodyJson: payload,
  });
}

export function createGuildWarHistory(payload: {
  event_id?: string;
  war_name: string;
  enemy_name?: string;
  result?: "win" | "loss" | "draw";
  own_kills?: number;
  own_towers?: number;
  own_base_hp?: number;
  own_credits?: number;
  own_distance?: number;
  enemy_kills?: number;
  enemy_towers?: number;
  enemy_base_hp?: number;
  enemy_credits?: number;
  enemy_distance?: number;
  notes?: string;
}): Promise<WarHistory> {
  return apiRequest<WarHistory>("/api/guild-war/history", {
    method: "POST",
    bodyJson: payload,
  });
}

export function updateGuildWarHistory(id: string, payload: Record<string, unknown>): Promise<WarHistory> {
  return apiRequest<WarHistory>(`/api/guild-war/history/${id}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function updateGuildWarMemberStats(
  id: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<WarTeamMember> {
  return apiRequest<WarTeamMember>(`/api/guild-war/history/${id}/member-stats/${userId}`, {
    method: "PATCH",
    bodyJson: payload,
  });
}

export function createGuildWarTemplate(payload: {
  event_id: string;
  template_name: string;
  description?: string;
}): Promise<WarTemplate> {
  return apiRequest<WarTemplate>("/api/guild-war/templates", {
    method: "POST",
    bodyJson: payload,
  });
}

export function applyGuildWarTemplate(payload: {
  event_id: string;
  template_id: string;
}): Promise<{ ok: true; war_history_id: string }> {
  return apiRequest<{ ok: true; war_history_id: string }>("/api/guild-war/templates/apply", {
    method: "POST",
    bodyJson: payload,
  });
}

export function deleteGuildWarTemplate(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/guild-war/templates/${id}`, {
    method: "DELETE",
  });
}
