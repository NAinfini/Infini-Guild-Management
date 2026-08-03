// @vitest-environment jsdom
import type { GuildWarActiveResponse } from "@guild/shared";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useGuildWarDragData } from "./useGuildWarDragData";

const initialData = {
  teams: [
    {
      id: "team-1",
      war_history_id: null,
      event_id: "event-1",
      team_name: "Alpha",
      sort_order: 0,
      notes: null,
      is_locked: false,
      members: [],
    },
    {
      id: "team-2",
      war_history_id: null,
      event_id: "event-1",
      team_name: "Bravo",
      sort_order: 1,
      notes: null,
      is_locked: false,
      members: [],
    },
  ],
  pool: [],
  etag: '"initial"',
} as unknown as GuildWarActiveResponse;

function useDragDataHarness(activeData: GuildWarActiveResponse) {
  const [teamDraftNames, setTeamDraftNames] = useState<Record<string, string>>({});
  const [, setTeamDraftNotes] = useState<Record<string, string>>({});
  const [teamDraftLocks, setTeamDraftLocks] = useState<Record<string, boolean>>({});
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const dragData = useGuildWarDragData({
    activeData,
    usersData: undefined,
    poolLabel: "Pool",
    draft: {
      teamDraftNames,
      setTeamDraftNames,
      setTeamDraftNotes,
      teamDraftLocks,
      setTeamDraftLocks,
      teamOrder,
      setTeamOrder,
    },
  });
  return { ...dragData, teamOrder };
}

describe("useGuildWarDragData", () => {
  it("follows remote team ordering when no local order draft exists", () => {
    let data = initialData;
    const { result, rerender } = renderHook(() => useDragDataHarness(data));

    expect(result.current.teamOrder).toEqual([]);
    expect(result.current.orderedTeams.map((team) => team.id)).toEqual(["team-1", "team-2"]);

    data = {
      ...initialData,
      teams: [
        { ...initialData.teams[1]!, sort_order: 0 },
        { ...initialData.teams[0]!, sort_order: 1 },
      ],
      etag: '"remote"',
    };
    act(() => rerender());

    expect(result.current.teamOrder).toEqual([]);
    expect(result.current.orderedTeams.map((team) => team.id)).toEqual(["team-2", "team-1"]);
  });
});
