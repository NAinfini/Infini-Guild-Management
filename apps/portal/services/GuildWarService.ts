import type { QueryClient } from "@tanstack/react-query";
import {
  batchUpdateGuildWarMemberStats,
  batchDeleteGuildWarHistory,
  concludeGuildWar,
  deleteGuildWarHistory,
  moveGuildWarMember,
  saveGuildWarTeams as saveGuildWarTeamsMutation,
  updateGuildWarHistory,
  type SaveTeamsPayload,
  updateGuildWarRoleTag,
  updateGuildWarRoleTags,
} from "../api/mutations/guild-war";
import { queryKeys } from "../api/query-keys";
import type { GuildWarActiveResponse } from "@guild/shared";
import {
  downloadGuildWarExport,
  fetchGuildWarActive,
  fetchGuildWarAnalytics,
  fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory,
  fetchGuildWarHistoryBatch,
  fetchGuildWarHistoryDetail,
} from "../api/queries/guild-war";

export {
  batchDeleteGuildWarHistory,
  batchUpdateGuildWarMemberStats,
  concludeGuildWar,
  deleteGuildWarHistory,
  downloadGuildWarExport,
  fetchGuildWarActive,
  fetchGuildWarAnalytics,
  fetchGuildWarConcludedEventIds,
  fetchGuildWarHistory,
  fetchGuildWarHistoryBatch,
  fetchGuildWarHistoryDetail,
  moveGuildWarMember,
  updateGuildWarHistory,
  updateGuildWarRoleTag,
  updateGuildWarRoleTags,
};

export const guildWarQueryKeys = queryKeys.guildWar;
export const usersQueryKeys = queryKeys.users;
export const absenceQueryKeys = queryKeys.absences;

export const ANALYTICS_SELECTION_SOFT_CAP = 10;
const ANALYTICS_SELECTION_HARD_CAP = 20;

type GuildWarTeam = GuildWarActiveResponse["teams"][number];
type GuildWarPoolMember = GuildWarActiveResponse["pool"][number];

type PersistTeamSnapshotInput = {
  eventId: string;
  teams: GuildWarTeam[];
  pool: GuildWarPoolMember[];
  teamDraftNames: Record<string, string>;
  teamDraftNotes: Record<string, string>;
  teamDraftLocks: Record<string, boolean>;
  etag?: string;
};

type AnalyticsSelectionResult =
  | { selection: string[]; warning: null }
  | { selection: string[]; warning: { type: "large"; count: number } }
  | { selection: string[]; warning: { type: "capped"; cap: number } };

type GuildWarServiceDeps = {
  queryClient?: QueryClient;
  saveGuildWarTeams?: typeof saveGuildWarTeamsMutation;
};

export class GuildWarService {
  private readonly queryClient?: QueryClient;
  private readonly saveGuildWarTeamsFn: typeof saveGuildWarTeamsMutation;

  constructor(deps: GuildWarServiceDeps) {
    this.queryClient = deps.queryClient;
    this.saveGuildWarTeamsFn = deps.saveGuildWarTeams ?? saveGuildWarTeamsMutation;
  }

  buildSaveTeamsPayload(input: PersistTeamSnapshotInput): SaveTeamsPayload {
    return {
      event_id: input.eventId,
      teams: input.teams.map((team, teamIndex) => ({
        team_name: (input.teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name,
        sort_order: teamIndex,
        notes: (input.teamDraftNotes[team.id] ?? team.notes ?? "").trim() || undefined,
        is_locked: input.teamDraftLocks[team.id] ?? team.is_locked,
        members: team.members.map((member, memberIndex) => ({
          user_id: member.user_id,
          role_tag: member.role_tag ?? undefined,
          sort_order: memberIndex,
        })),
      })),
      pool_members: input.pool.map((member) => ({
        user_id: member.userId,
      })),
    };
  }

  async persistTeamSnapshot(input: PersistTeamSnapshotInput) {
    const response = await this.saveGuildWarTeamsFn(this.buildSaveTeamsPayload(input), input.etag);
    if (this.queryClient) {
      await Promise.all([
        this.queryClient.invalidateQueries({
          queryKey: queryKeys.guildWar.active(input.eventId),
        }),
        this.queryClient.invalidateQueries({
          queryKey: queryKeys.guildWar.historyAll(),
        }),
      ]);
    }
    return response;
  }

  applyAnalyticsSelection(nextSelection: string[]): AnalyticsSelectionResult {
    const selection = Array.from(new Set(nextSelection));

    if (selection.length > ANALYTICS_SELECTION_HARD_CAP) {
      return {
        selection: selection.slice(0, ANALYTICS_SELECTION_HARD_CAP),
        warning: {
          type: "capped",
          cap: ANALYTICS_SELECTION_HARD_CAP,
        },
      };
    }

    if (selection.length > ANALYTICS_SELECTION_SOFT_CAP) {
      return {
        selection,
        warning: {
          type: "large",
          count: selection.length,
        },
      };
    }

    return {
      selection,
      warning: null,
    };
  }
}
