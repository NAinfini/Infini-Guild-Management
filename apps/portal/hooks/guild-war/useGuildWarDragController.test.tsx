import type { GuildWarActiveResponse } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuildWarDragController } from "./useGuildWarDragController";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  move: vi.fn(),
  fetchActive: vi.fn(),
}));
const fixtures = vi.hoisted(() => {
  const oldTeam = {
    id: "team-1", team_name: "Alpha", notes: null, is_locked: false, sort_order: 0,
    war_history_id: null, event_id: "event-1",
    members: [{ id: "member-1", war_team_id: "team-1", user_id: "user-1", role_tag: null, sort_order: 0 }],
  };
  const remainingTeam = {
    id: "team-2", team_name: "Beta", notes: null, is_locked: false, sort_order: 1,
    war_history_id: null, event_id: "event-1", members: [],
  };
  return { oldTeam, remainingTeam };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@portal/hooks/useConfirmDialog", () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock("../../utils/notifications", () => ({ notifySuccess: vi.fn(), notifyWarning: vi.fn() }));
vi.mock("../../services/GuildWarService", () => ({
  GuildWarService: class {},
  guildWarQueryKeys: { active: (id: string | null) => ["guild-war", "active", id] },
  moveGuildWarMember: mocks.move,
  fetchGuildWarActive: mocks.fetchActive,
}));
vi.mock("./useGuildWarSearch", () => ({
  useGuildWarSearch: () => ({ matchedItemIds: [], activeMatchIndex: 0, toMemberDomId: (id: string) => id }),
}));

const { oldTeam, remainingTeam } = fixtures;
const activeData = { teams: [oldTeam, remainingTeam], pool: [], etag: '"old"' } as unknown as GuildWarActiveResponse;

vi.mock("./useGuildWarDragData", () => ({
  useGuildWarDragData: () => ({
    orderedTeams: [fixtures.oldTeam, fixtures.remainingTeam],
    teamById: new Map([[fixtures.oldTeam.id, fixtures.oldTeam], [fixtures.remainingTeam.id, fixtures.remainingTeam]]),
    memberTeamByUserId: new Map(), allTeamMembers: [], userDataMap: new Map(), lockedTeamIds: new Set(),
    activeMemberDetailByUserId: new Map(), dragColumns: [], memberContainerMap: new Map(), dragItemMap: new Map(), pool: [],
    teamCount: 2, teamIndexMap: new Map(),
  }),
}));

function setup(persistTeamSnapshot = vi.fn().mockResolvedValue({ ok: true })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const showError = vi.fn();
  const activeController = {
    activeDragItemId: null, setActiveDragItemId: vi.fn(), teamDraftNames: {}, setTeamDraftNames: vi.fn(),
    teamDraftNotes: {}, setTeamDraftNotes: vi.fn(), teamDraftLocks: {}, setTeamDraftLocks: vi.fn(),
    teamOrder: [], setTeamOrder: vi.fn(), activeSearch: "", searchJumpIndex: 0, setSearchJumpIndex: vi.fn(),
    activeDetailUserId: null, setActiveDetailUserId: vi.fn(), moveTeamOrder: vi.fn(),
  };
  return {
    persistTeamSnapshot, showError, client,
    ...renderHook(() => useGuildWarDragController({
      activeData, usersData: [], canManageActive: true, selectedEventId: "event-1",
      activeController, roleTagMutation: { isPending: false, mutate: vi.fn() },
      guildWarService: { persistTeamSnapshot } as never, showError,
    }), { wrapper }),
  };
}

describe("useGuildWarDragController team deletion", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true); });

  it("awaits moving members, refreshes active state, then saves with the new ETag", async () => {
    const order: string[] = [];
    mocks.move.mockImplementation(async () => { order.push("move"); return { ok: true }; });
    const latest = {
      ...activeData,
      teams: [{ ...oldTeam, members: [] }, remainingTeam],
      pool: [{ id: "pool-1", warHistoryId: "", userId: "user-1" }],
      etag: '"new"',
    } as unknown as GuildWarActiveResponse;
    mocks.fetchActive.mockImplementation(async () => { order.push("refresh"); return latest; });
    const persist = vi.fn().mockImplementation(async () => { order.push("save"); return { ok: true }; });
    const { result } = setup(persist);

    act(() => result.current.handleDeleteTeam("team-1"));
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());

    expect(order).toEqual(["move", "refresh", "save"]);
    expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({ etag: '"old"' }));
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      etag: '"new"', pool: latest.pool, teams: [expect.objectContaining({ id: "team-2", sort_order: 0 })],
    }));
  });

  it("stops before refresh/save when moving members fails and refetches the active query", async () => {
    mocks.move.mockRejectedValue(new Error("move failed"));
    const persist = vi.fn();
    const { result, client, showError } = setup(persist);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    act(() => result.current.handleDeleteTeam("team-1"));
    await waitFor(() => expect(showError).toHaveBeenCalled());

    expect(mocks.fetchActive).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["guild-war", "active", "event-1"] });
  });
});
