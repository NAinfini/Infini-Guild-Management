import { useMemo } from "react";
import { format } from "date-fns";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "yyyy-MM-dd HH:mm");
}

type UseGuildWarHistoryParams = {
  historyDetailData: {
    id: string;
    teams: Array<{
      team_name: string;
      members: Array<{
        user_id: string;
        username?: string;
        role_tag?: string | null;
      }>;
    }>;
    member_stats: Array<{
      user_id: string;
      username?: string;
      stats: Record<string, number | null> | null;
    }>;
  } | null;
};

export function useGuildWarHistory({
  historyDetailData,
}: UseGuildWarHistoryParams) {
  const historyMvp = useMemo(() => {
    const stats = historyDetailData?.member_stats ?? [];
    if (stats.length === 0) {
      return null;
    }

    const topDamage = [...stats].sort((a, b) => (b.stats?.damage ?? 0) - (a.stats?.damage ?? 0))[0] ?? null;
    const topHealing = [...stats].sort((a, b) => (b.stats?.healing ?? 0) - (a.stats?.healing ?? 0))[0] ?? null;
    const topBuilding = [...stats].sort((a, b) => (b.stats?.building_damage ?? 0) - (a.stats?.building_damage ?? 0))[0] ?? null;
    const topDamageTaken = [...stats].sort((a, b) => (b.stats?.damage_taken ?? 0) - (a.stats?.damage_taken ?? 0))[0] ?? null;

    return {
      damage: topDamage ? `${topDamage.username ?? topDamage.user_id} (${topDamage.stats?.damage ?? 0})` : "-",
      healing: topHealing ? `${topHealing.username ?? topHealing.user_id} (${topHealing.stats?.healing ?? 0})` : "-",
      building: topBuilding ? `${topBuilding.username ?? topBuilding.user_id} (${topBuilding.stats?.building_damage ?? 0})` : "-",
      damageTaken: topDamageTaken ? `${topDamageTaken.username ?? topDamageTaken.user_id} (${topDamageTaken.stats?.damage_taken ?? 0})` : "-",
    };
  }, [historyDetailData]);

  const historyTeamSizeBaseline = useMemo(() => {
    const teams = historyDetailData?.teams ?? [];
    if (teams.length === 0) {
      return 0;
    }
    return teams.reduce((max, team) => Math.max(max, team.members.length), 0);
  }, [historyDetailData?.teams]);

  const historyMissingSlotsByUserId = useMemo(() => {
    const map = new Map<string, number>();
    const teams = historyDetailData?.teams ?? [];
    if (historyTeamSizeBaseline <= 0 || teams.length === 0) {
      return map;
    }
    for (const team of teams) {
      const missing = Math.max(0, historyTeamSizeBaseline - team.members.length);
      for (const member of team.members) {
        map.set(member.user_id, missing);
      }
    }
    return map;
  }, [historyDetailData?.teams, historyTeamSizeBaseline]);

  return {
    historyMvp,
    historyMissingSlotsByUserId,
    formatDateTime,
  };
}
