import {
  concludeWarPayloadSchema,
  moveGuildWarMemberSchema,
  saveTeamsPayloadSchema,
  updateGuildWarRoleTagsSchema,
  updateMemberStatsSchema,
  updateWarHistorySchema,
  type WarHistory,
  type WarTeamMember,
} from "@guild/shared";
import type { z } from "zod";
import { apiRequest } from "../client";

export type SaveTeamsPayload = z.input<typeof saveTeamsPayloadSchema>;
export type MoveGuildWarMemberPayload = z.input<typeof moveGuildWarMemberSchema>;
export type UpdateGuildWarRoleTagsPayload = z.input<typeof updateGuildWarRoleTagsSchema>;
export type UpdateGuildWarMemberStatsPayload = z.input<typeof updateMemberStatsSchema>;
export type UpdateWarHistoryPayload = z.input<typeof updateWarHistorySchema>;
export type ConcludeWarPayload = z.input<typeof concludeWarPayloadSchema>;

export function saveGuildWarTeams(payload: SaveTeamsPayload, etag?: string): Promise<{ ok: true }> {
  const bodyJson = saveTeamsPayloadSchema.parse(payload);
  return apiRequest<{ ok: true }>("/api/guild-war/save-teams", {
    method: "POST",
    bodyJson,
    ifMatch: etag,
  });
}

export function concludeGuildWar(payload: ConcludeWarPayload): Promise<{ war_history_id: string }> {
  const bodyJson = concludeWarPayloadSchema.parse(payload);
  return apiRequest<{ war_history_id: string }>("/api/guild-war/conclude", {
    method: "POST",
    bodyJson,
  });
}

export function moveGuildWarMember(payload: MoveGuildWarMemberPayload & { etag?: string }): Promise<{ ok: true }> {
  const { etag, ...body } = payload;
  return apiRequest<{ ok: true }>("/api/guild-war/move", {
    method: "POST",
    ifMatch: etag,
    bodyJson: moveGuildWarMemberSchema.parse(body),
  });
}

export function updateGuildWarRoleTag(payload: {
  event_id: string;
  user_id: string;
  role_tag: string | null;
}): Promise<{ ok: true }> {
  return updateGuildWarRoleTags({
    event_id: payload.event_id,
    updates: [{ user_id: payload.user_id, role_tag: payload.role_tag }],
  }).then(() => ({ ok: true as const }));
}

export function updateGuildWarRoleTags(payload: UpdateGuildWarRoleTagsPayload): Promise<{ ok: true; updated: number }> {
  return apiRequest<{ ok: true; updated: number }>("/api/guild-war/role-tag", {
    method: "PATCH",
    bodyJson: updateGuildWarRoleTagsSchema.parse(payload),
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

export function updateGuildWarHistory(historyId: string, payload: UpdateWarHistoryPayload): Promise<WarHistory> {
  return apiRequest<WarHistory>(`/api/guild-war/history/${historyId}`, {
    method: "PATCH",
    bodyJson: updateWarHistorySchema.parse(payload),
  });
}
