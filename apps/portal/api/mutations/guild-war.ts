import {
  saveTeamsPayloadSchema,
  updateMemberStatsSchema,
  type WarHistory,
  type WarTeamMember,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type SaveTeamsPayload = z.input<typeof saveTeamsPayloadSchema>;
export type UpdateGuildWarMemberStatsPayload = z.input<typeof updateMemberStatsSchema>;

export function saveGuildWarTeams(payload: SaveTeamsPayload, etag?: string): Promise<WarHistory> {
  const bodyJson = saveTeamsPayloadSchema.parse(payload);
  return apiRequest<WarHistory>("/api/guild-war/save-teams", {
    method: "POST",
    bodyJson,
    ifMatch: etag,
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

export function deleteGuildWarHistory(id: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(`/api/guild-war/history/${id}`, {
    method: "DELETE",
  });
}

export function batchDeleteGuildWarHistory(ids: string[]): Promise<{ ok: true; deleted: number }> {
  return apiRequest<{ ok: true; deleted: number }>("/api/guild-war/history/batch-delete", {
    method: "POST",
    bodyJson: { ids },
  });
}
