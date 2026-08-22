import { useMemo } from "react";
import { formatDateTime } from "../../utils/datetime";
import { DEFAULT_GAME_RULES } from "@guild/shared";
import { getGuildWarMemberStatLabel } from "@portal/utils/game-rules";

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
  const gameRules = DEFAULT_GAME_RULES;
  const historyMvp = useMemo(() => {
    const stats = historyDetailData?.member_stats ?? [];
    if (stats.length === 0) {
      return null;
    }

    return gameRules.guild_war.member_stats
      .filter((definition) => definition.mvp)
      .map((definition) => {
        const ranked = stats
          .flatMap((member) => {
            const value = member.stats?.[definition.key];
            return typeof value === "number" && Number.isFinite(value)
              ? [{ member, value }]
              : [];
          })
          .sort((left, right) => definition.lower_is_better
            ? left.value - right.value
            : right.value - left.value);
        const top = ranked[0] ?? null;
        return {
          key: definition.key,
          label: getGuildWarMemberStatLabel(definition.key),
          value: top ? `${top.member.username ?? top.member.user_id} (${top.value})` : "-",
        };
      });
  }, [gameRules, historyDetailData]);

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
