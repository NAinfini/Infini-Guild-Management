import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/query-keys";
import { GuildWarService, updateGuildWarRoleTags } from "../GuildWarService";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseTeams = [
  {
    id: "team-1",
    war_history_id: null,
    event_id: "event-1",
    team_name: "Alpha",
    sort_order: 0,
    notes: null,
    is_locked: false,
    members: [
      { id: "m-1", war_team_id: "team-1", user_id: "u-1", role_tag: "tank", sort_order: 0, stats: null, note: null },
    ],
  },
];

describe("GuildWarService", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends role tag updates as one batch request", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true, updated: 2 }));
    await updateGuildWarRoleTags({
      event_id: "event-1",
      updates: [
        { user_id: "u-1", role_tag: "tank" },
        { user_id: "u-2", role_tag: null },
      ],
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/guild-war/role-tag");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      event_id: "event-1",
      updates: [
        { user_id: "u-1", role_tag: "tank" },
        { user_id: "u-2", role_tag: null },
      ],
    });
  });

  it("builds save payloads from ordered teams, pool members, and draft overrides", () => {
    const service = new GuildWarService({
      queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
      saveGuildWarTeams: vi.fn(),
    });

    const payload = service.buildSaveTeamsPayload({
      eventId: "event-1",
      teams: baseTeams,
      pool: [{ id: "pool-1", warHistoryId: null, eventId: "event-1", userId: "u-9" }],
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
