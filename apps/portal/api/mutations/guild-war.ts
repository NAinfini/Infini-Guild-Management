import {
  applyWarTemplateSchema,
  createWarHistorySchema,
  createWarTemplateSchema,
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  type WarHistory,
  type WarTeamMember,
  type WarTemplate,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type SaveTeamsPayload = z.input<typeof saveTeamsPayloadSchema>;
export type CreateGuildWarHistoryPayload = z.input<typeof createWarHistorySchema>;
export type UpdateGuildWarHistoryPayload = z.input<typeof updateWarHistorySchema>;
export type UpdateGuildWarMemberStatsPayload = z.input<typeof updateMemberStatsSchema>;
export type CreateGuildWarTemplatePayload = z.input<typeof createWarTemplateSchema>;
export type ApplyGuildWarTemplatePayload = z.input<typeof applyWarTemplateSchema>;

export function saveGuildWarTeams(payload: SaveTeamsPayload): Promise<WarHistory> {
  const bodyJson = saveTeamsPayloadSchema.parse(payload);
  return apiRequest<WarHistory>("/api/guild-war/save-teams", {
    method: "POST",
    bodyJson,
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

export function createGuildWarHistory(payload: CreateGuildWarHistoryPayload): Promise<WarHistory> {
  const bodyJson = createWarHistorySchema.parse(payload);
  return apiRequest<WarHistory>("/api/guild-war/history", {
    method: "POST",
    bodyJson,
  });
}

export function updateGuildWarHistory(
  id: string,
  payload: UpdateGuildWarHistoryPayload,
): Promise<WarHistory> {
  const bodyJson = updateWarHistorySchema.parse(payload);
  return apiRequest<WarHistory>(`/api/guild-war/history/${id}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function updateGuildWarMemberStats(
  id: string,
  userId: string,
  payload: UpdateGuildWarMemberStatsPayload,
): Promise<WarTeamMember> {
  const bodyJson = updateMemberStatsSchema.parse(payload);
  return apiRequest<WarTeamMember>(`/api/guild-war/history/${id}/member-stats/${userId}`, {
    method: "PATCH",
    bodyJson,
  });
}

export function batchUpdateGuildWarMemberStats(
  historyId: string,
  updates: Array<{ user_id: string; stats: UpdateGuildWarMemberStatsPayload }>,
): Promise<{ data: WarTeamMember[] }> {
  return apiRequest<{ data: WarTeamMember[] }>(`/api/guild-war/history/${historyId}/member-stats/batch`, {
    method: "PATCH",
    bodyJson: {
      updates: updates.map((u) => ({
        user_id: u.user_id,
        stats: updateMemberStatsSchema.parse(u.stats),
      })),
    },
  });
}

export function createGuildWarTemplate(payload: CreateGuildWarTemplatePayload): Promise<WarTemplate> {
  const bodyJson = createWarTemplateSchema.parse(payload);
  return apiRequest<WarTemplate>("/api/guild-war/templates", {
    method: "POST",
    bodyJson,
  });
}

export function applyGuildWarTemplate(
  payload: ApplyGuildWarTemplatePayload,
): Promise<{ ok: true; war_history_id: string }> {
  const bodyJson = applyWarTemplateSchema.parse(payload);
  return apiRequest<{ ok: true; war_history_id: string }>("/api/guild-war/templates/apply", {
    method: "POST",
    bodyJson,
  });
}

export function deleteGuildWarHistory(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/guild-war/history/${id}`, {
    method: "DELETE",
  });
}

export function deleteGuildWarTemplate(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/guild-war/templates/${id}`, {
    method: "DELETE",
  });
}
