import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";
import { GuildWarService } from "../GuildWarService";

const baseTeams = [
  {
    id: "team-1",
    war_history_id: "war-1",
    team_name: "Alpha",
    sort_order: 0,
    notes: null,
    is_locked: false,
    members: [
      { id: "m-1", war_team_id: "team-1", user_id: "u-1", role_tag: "tank", sort_order: 0, kills: null, deaths: null, assists: null, damage: null, healing: null, building_damage: null, credits: null, damage_taken: null, note: null },
    ],
  },
];

describe("GuildWarService", () => {
  it("builds save payloads from ordered teams, pool members, and draft overrides", () => {
    const service = new GuildWarService({
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      saveGuildWarTeams: vi.fn(),
    });

    const payload = service.buildSaveTeamsPayload({
      eventId: "event-1",
      teams: baseTeams,
      pool: [{ id: "pool-1", warHistoryId: "war-1", userId: "u-9" }],
      teamDraftNames: { "team-1": " Alpha Prime " },
      teamDraftNotes: { "team-1": " Burst comp " },
      teamDraftLocks: { "team-1": true },
    });

    expect(payload).toEqual({
      event_id: "event-1",
      teams: [
        {
          team_name: "Alpha Prime",
          sort_order: 0,
          notes: "Burst comp",
          is_locked: true,
          members: [{ user_id: "u-1", role_tag: "tank", sort_order: 0 }],
        },
      ],
      pool_members: [{ user_id: "u-9" }],
    });
  });

  it("persists snapshots and invalidates the active guild war query", async () => {
    const saveGuildWarTeams = vi.fn().mockResolvedValue({ id: "war-1" });
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const service = new GuildWarService({
      queryClient: { invalidateQueries } as unknown as QueryClient,
      saveGuildWarTeams,
    });

    await service.persistTeamSnapshot({
      eventId: "event-1",
      teams: baseTeams,
      pool: [],
      teamDraftNames: {},
      teamDraftNotes: {},
      teamDraftLocks: {},
    });

    expect(saveGuildWarTeams).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: "event-1",
      }),
      undefined,
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.guildWar.active("event-1"),
    });
  });

  it("deduplicates analytics selection and returns cap warnings", () => {
    const service = new GuildWarService({
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      saveGuildWarTeams: vi.fn(),
    });

    const largeSelection = service.applyAnalyticsSelection([
      "u-1",
      "u-1",
      "u-2",
      "u-3",
      "u-4",
      "u-5",
      "u-6",
      "u-7",
      "u-8",
      "u-9",
      "u-10",
      "u-11",
    ]);
    const cappedSelection = service.applyAnalyticsSelection(
      Array.from({ length: 25 }, (_, index) => `u-${index}`),
    );

    expect(largeSelection.selection).toHaveLength(11);
    expect(largeSelection.warning).toEqual({
      type: "large",
      count: 11,
    });
    expect(cappedSelection.selection).toHaveLength(20);
    expect(cappedSelection.warning).toEqual({
      type: "capped",
      cap: 20,
    });
  });
});
