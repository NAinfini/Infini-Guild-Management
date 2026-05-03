import type { GuildWarActiveResponse } from "@guild/shared";
import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { UsersListResponse } from "../../api/queries/users";

export type DragMemberItem = {
  itemId: string;
  userId: string;
  username: string;
  power: number;
  class: string;
  subtitle: string;
};

export type DragMemberColumn = {
  containerId: string;
  title: string;
  locked: boolean;
  members: DragMemberItem[];
};

function shallowArrayEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function shallowRecordEqual<T extends string | boolean>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

type TeamDraftState = {
  teamDraftNames: Record<string, string>;
  setTeamDraftNames: Dispatch<SetStateAction<Record<string, string>>>;
  setTeamDraftNotes: Dispatch<SetStateAction<Record<string, string>>>;
  teamDraftLocks: Record<string, boolean>;
  setTeamDraftLocks: Dispatch<SetStateAction<Record<string, boolean>>>;
  teamOrder: string[];
  setTeamOrder: Dispatch<SetStateAction<string[]>>;
};

type UseGuildWarDragDataParams = {
  activeData: GuildWarActiveResponse | undefined;
  usersData: UsersListResponse["data"] | undefined;
  poolLabel: string;
  draft: TeamDraftState;
};

export function useGuildWarDragData({ activeData, usersData, poolLabel, draft }: UseGuildWarDragDataParams) {
  const teams = activeData?.teams ?? [];
  const pool = activeData?.pool ?? [];
  const { teamDraftNames, setTeamDraftNames, setTeamDraftNotes, teamDraftLocks, setTeamDraftLocks, teamOrder, setTeamOrder } = draft;

  const userDataMap = useMemo(() => {
    const map = new Map<string, { username: string; power: number; class: string }>();
    for (const item of usersData ?? []) {
      map.set(item.user.id, {
        username: item.user.username,
        power: item.profile.power,
        class: item.profile.classes[0] ?? "Unknown",
      });
    }
    return map;
  }, [usersData]);

  const orderedTeams = useMemo(() => {
    if (teamOrder.length === 0) return teams;
    const byId = new Map(teams.map((team) => [team.id, team]));
    const ordered = teamOrder.map((id) => byId.get(id)).filter((t): t is (typeof teams)[number] => Boolean(t));
    const missing = teams.filter((team) => !teamOrder.includes(team.id));
    return [...ordered, ...missing];
  }, [teamOrder, teams]);

  const teamById = useMemo<Map<string, (typeof orderedTeams)[number]>>(
    () => new Map(orderedTeams.map((team) => [team.id, team])),
    [orderedTeams],
  );

  const memberTeamByUserId = useMemo(() => {
    const map = new Map<string, (typeof orderedTeams)[number]>();
    for (const team of orderedTeams) {
      for (const member of team.members) {
        map.set(member.user_id, team);
      }
    }
    return map;
  }, [orderedTeams]);

  const allTeamMembers = useMemo(
    () => orderedTeams.flatMap((team) => team.members),
    [orderedTeams],
  );

  useEffect(() => {
    if (teams.length === 0) return;

    setTeamOrder((current) => {
      const ids = teams.map((team) => team.id);
      const preserved = current.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !preserved.includes(id));
      const next = [...preserved, ...missing];
      return shallowArrayEqual(current, next) ? current : next;
    });

    setTeamDraftNames((current) => {
      const next: Record<string, string> = {};
      for (const team of teams) next[team.id] = current[team.id] ?? team.team_name;
      return shallowRecordEqual(current, next) ? current : next;
    });

    setTeamDraftNotes((current) => {
      const next: Record<string, string> = {};
      for (const team of teams) next[team.id] = current[team.id] ?? team.notes ?? "";
      return shallowRecordEqual(current, next) ? current : next;
    });

    setTeamDraftLocks((current) => {
      const next: Record<string, boolean> = {};
      for (const team of teams) next[team.id] = current[team.id] ?? team.is_locked;
      return shallowRecordEqual(current, next) ? current : next;
    });
  }, [setTeamDraftLocks, setTeamDraftNames, setTeamDraftNotes, setTeamOrder, teams]);

  const lockedTeamIds = useMemo(
    () => new Set(orderedTeams.filter((team) => teamDraftLocks[team.id] ?? team.is_locked).map((team) => team.id)),
    [orderedTeams, teamDraftLocks],
  );

  const activeMemberDetailByUserId = useMemo(() => {
    const map = new Map<
      string,
      {
        teamName: string;
        roleTag: string | null;
        kills: number;
        deaths: number;
        assists: number;
        damage: number;
        healing: number;
        buildingDamage: number;
        credits: number;
      }
    >();

    for (const team of orderedTeams) {
      const teamName = (teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name;
      for (const member of team.members) {
        map.set(member.user_id, {
          teamName,
          roleTag: member.role_tag ?? null,
          kills: member.kills ?? 0,
          deaths: member.deaths ?? 0,
          assists: member.assists ?? 0,
          damage: member.damage ?? 0,
          healing: member.healing ?? 0,
          buildingDamage: member.building_damage ?? 0,
          credits: member.credits ?? 0,
        });
      }
    }

    for (const member of pool) {
      if (!map.has(member.userId)) {
        map.set(member.userId, {
          teamName: "Pool",
          roleTag: null,
          kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, buildingDamage: 0, credits: 0,
        });
      }
    }

    return map;
  }, [orderedTeams, pool, teamDraftNames]);

  const dragColumns = useMemo<DragMemberColumn[]>(() => {
    const teamColumns = orderedTeams.map((team) => ({
      containerId: team.id,
      title: (teamDraftNames[team.id] ?? team.team_name).trim() || team.team_name,
      locked: lockedTeamIds.has(team.id),
      members: team.members.map((member) => {
        const userData = userDataMap.get(member.user_id);
        return {
          itemId: `member:${member.user_id}`,
          userId: member.user_id,
          username: userData?.username ?? member.user_id,
          power: userData?.power ?? 0,
          class: userData?.class ?? "Unknown",
          subtitle: `${member.role_tag ? `[${member.role_tag}] ` : ""}K/D/A: ${member.kills ?? 0}/${member.deaths ?? 0}/${member.assists ?? 0}`,
        };
      }),
    }));

    const poolColumn: DragMemberColumn = {
      containerId: "pool",
      title: poolLabel,
      locked: false,
      members: pool.map((member) => {
        const userData = userDataMap.get(member.userId);
        return {
          itemId: `member:${member.userId}`,
          userId: member.userId,
          username: userData?.username ?? member.userId,
          power: userData?.power ?? 0,
          class: userData?.class ?? "Unknown",
          subtitle: "Pool",
        };
      }),
    };

    return [...teamColumns, poolColumn];
  }, [lockedTeamIds, orderedTeams, pool, poolLabel, teamDraftNames, userDataMap]);

  const memberContainerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const column of dragColumns) {
      for (const member of column.members) map.set(member.itemId, column.containerId);
    }
    return map;
  }, [dragColumns]);

  const dragItemMap = useMemo(() => {
    const map = new Map<string, DragMemberItem>();
    for (const column of dragColumns) {
      for (const member of column.members) map.set(member.itemId, member);
    }
    return map;
  }, [dragColumns]);

  const draggableUserOrder = useMemo(
    () => dragColumns.flatMap((column) => column.members.map((member) => member.userId)),
    [dragColumns],
  );

  const draggableUserOrderIndexMap = useMemo(
    () => new Map(draggableUserOrder.map((userId, index) => [userId, index])),
    [draggableUserOrder],
  );

  return {
    teams,
    pool,
    orderedTeams,
    teamById,
    memberTeamByUserId,
    allTeamMembers,
    userDataMap,
    lockedTeamIds,
    activeMemberDetailByUserId,
    dragColumns,
    memberContainerMap,
    dragItemMap,
    draggableUserOrder,
    draggableUserOrderIndexMap,
  };
}
