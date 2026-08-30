import type { GuildWarActiveResponse } from "@guild/shared";
import type { UsersListResponse } from "../../services/UserService";
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

function useDragDataHarness(
  activeData: GuildWarActiveResponse,
  usersData?: UsersListResponse["data"],
) {
  const [teamDraftNames, setTeamDraftNames] = useState<Record<string, string>>({});
  const [, setTeamDraftNotes] = useState<Record<string, string>>({});
  const [teamDraftLocks, setTeamDraftLocks] = useState<Record<string, boolean>>({});
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const dragData = useGuildWarDragData({
    activeData,
    usersData,
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

  it("builds member details from the protected profile projection, not war assignment data", () => {
    const activeData = {
      ...initialData,
      teams: [{
        ...initialData.teams[0]!,
        members: [{
          id: "war-member-1",
          user_id: "user-1",
          role_tag: "Leader",
          sort_order: 0,
          stats: { kills: 99 },
          note: "saved war note",
        }],
      }],
    } as unknown as GuildWarActiveResponse;
    const availability = {
      timezone: "America/New_York",
      days: {
        sunday: [],
        monday: [{ start_utc: "23:00", end_utc: "24:00" }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
      },
    } as const;
    const usersData = [{
      user: {
        id: "user-1",
        display_name: "Alice",
      },
      profile: {
        power: 8200,
        classes: ["Mage"],
        title_html: "<strong>Coordinator</strong>",
        availability,
        vacation_start: "2026-08-20",
        vacation_end: "2026-08-24",
        notes: "Prefers late-night wars",
      },
      badges: [],
    }] as unknown as UsersListResponse["data"];

    const { result } = renderHook(() => useDragDataHarness(activeData, usersData));
    const detail = result.current.activeMemberDetailByUserId.get("user-1");

    expect(detail).toEqual({
      display_name: "Alice",
      power: 8200,
      classes: ["Mage"],
      titleHtml: "<strong>Coordinator</strong>",
      availability,
      vacationStart: "2026-08-20",
      vacationEnd: "2026-08-24",
      notes: "Prefers late-night wars",
    });
    expect(detail).not.toHaveProperty("teamName");
    expect(detail).not.toHaveProperty("roleTag");
    expect(detail).not.toHaveProperty("stats");
  });

  it("keeps active-war avatars while the member directory is unavailable", () => {
    const activeData = {
      ...initialData,
      teams: [{
        ...initialData.teams[0]!,
        members: [{
          id: "war-member-1",
          war_team_id: "team-1",
          user_id: "user-1",
          display_name: "Alice",
          avatar_media_id: "avatar1234567890abcde",
          role_tag: null,
          sort_order: 0,
          stats: null,
          note: null,
        }],
      }],
    } as GuildWarActiveResponse;

    const { result } = renderHook(() => useDragDataHarness(activeData));

    expect(result.current.dragColumns[0]?.members[0]).toMatchObject({
      display_name: "Alice",
      avatarMediaId: "avatar1234567890abcde",
    });
  });
});
