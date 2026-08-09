import type { GuildWarActiveResponse } from "@guild/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuildWarService } from "../../../services/GuildWarService";
import { useGuildWarActiveController } from "./useGuildWarActiveController";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => mocks.confirm,
}));

vi.mock("../../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

const activeData = {
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
  ],
  pool: [],
  etag: '"active-etag"',
} as unknown as GuildWarActiveResponse;

const orderedActiveData = {
  ...activeData,
  teams: [
    activeData.teams[0]!,
    { ...activeData.teams[0]!, id: "team-2", team_name: "Bravo", sort_order: 1 },
    { ...activeData.teams[0]!, id: "team-3", team_name: "Charlie", sort_order: 2 },
  ],
} as GuildWarActiveResponse;

function reorderActiveData(
  data: GuildWarActiveResponse,
  ids: string[],
  etag: string,
): GuildWarActiveResponse {
  const teamById = new Map(data.teams.map((team) => [team.id, team]));
  return {
    ...data,
    teams: ids.map((id, sortOrder) => ({ ...teamById.get(id)!, sort_order: sortOrder })),
    etag,
  };
}

function createGuildWarService(persistTeamSnapshot: GuildWarService["persistTeamSnapshot"]): GuildWarService {
  const service = new GuildWarService({});
  vi.spyOn(service, "persistTeamSnapshot").mockImplementation(persistTeamSnapshot);
  return service;
}

function renderController(
  persistTeamSnapshot: GuildWarService["persistTeamSnapshot"],
  showError = vi.fn(),
  data: GuildWarActiveResponse = activeData,
) {
  return {
    showError,
    ...renderHook(() =>
      useGuildWarActiveController({
        selectedEventId: "event-1",
        activeData: data,
        guildWarService: createGuildWarService(persistTeamSnapshot),
        showError,
      }),
    ),
  };
}

describe("useGuildWarActiveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.confirm.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-saves dirty team metadata with the active ETag after a short debounce", async () => {
    const persistTeamSnapshot = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderController(persistTeamSnapshot);

    act(() => {
      result.current.setTeamDraftNames({ "team-1": "Alpha Prime" });
    });
    expect(result.current.isTeamsDirty).toBe(true);
    expect(persistTeamSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(persistTeamSnapshot).toHaveBeenCalledTimes(1);
    expect(persistTeamSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        teamDraftNames: { "team-1": "Alpha Prime" },
        etag: '"active-etag"',
      }),
    );
    expect(result.current.saveTeamsPending).toBe(false);
  });

  it("confirms before switching away from dirty team drafts", async () => {
    const persistTeamSnapshot = vi.fn();
    const { result } = renderController(persistTeamSnapshot);
    mocks.confirm.mockResolvedValue(false);

    act(() => {
      result.current.setTeamDraftNotes({ "team-1": "Hold the bridge" });
    });

    await expect(result.current.confirmDiscardTeamsChanges()).resolves.toBe(false);
    expect(mocks.confirm).toHaveBeenCalledWith({
      title: "active.unsavedSwitchTitle",
      description: "active.unsavedSwitchDescription",
      confirmLabel: "active.discardChanges",
      cancelLabel: "common:action.cancel",
      intent: "warning",
    });
  });

  it("reports an automatic save failure and releases the pending guard", async () => {
    const error = new Error("conflict");
    const persistTeamSnapshot = vi.fn().mockRejectedValue(error);
    const showError = vi.fn();
    const { result } = renderController(persistTeamSnapshot, showError);

    act(() => {
      result.current.setTeamDraftLocks({ "team-1": true });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(showError).toHaveBeenCalledWith(error, "message.teamsSaveFailed");
    expect(result.current.saveTeamsPending).toBe(false);
  });

  it("accepts external changes for untouched fields", () => {
    const persist = vi.fn();
    let data = activeData;
    const { result, rerender } = renderHook(() => useGuildWarActiveController({
      selectedEventId: "event-1", activeData: data,
      guildWarService: createGuildWarService(persist),
      showError: vi.fn(),
    }));

    data = { ...activeData, teams: [{ ...activeData.teams[0]!, notes: "Remote note" }], etag: '"remote"' };
    rerender();

    expect(result.current.teamDraftNotes["team-1"]).toBeUndefined();
    expect(result.current.hasTeamDraftConflict).toBe(false);
  });

  it("does not debounce-save a dirty field over a remotely changed baseline", async () => {
    const persist = vi.fn();
    let data = activeData;
    const { result, rerender } = renderHook(() => useGuildWarActiveController({
      selectedEventId: "event-1", activeData: data,
      guildWarService: createGuildWarService(persist),
      showError: vi.fn(),
    }));
    act(() => result.current.setTeamDraftNames({ "team-1": "Local name" }));

    data = { ...activeData, teams: [{ ...activeData.teams[0]!, team_name: "Remote name" }], etag: '"remote"' };
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(result.current.hasTeamDraftConflict).toBe(true);
    expect(result.current.teamDraftNames["team-1"]).toBe("Local name");
    expect(persist).not.toHaveBeenCalled();
  });

  it("creates an order draft only after a successful move and detects a remote reorder", async () => {
    const persist = vi.fn();
    let data = orderedActiveData;
    const { result, rerender } = renderHook(() => useGuildWarActiveController({
      selectedEventId: "event-1",
      activeData: data,
      guildWarService: createGuildWarService(persist),
      showError: vi.fn(),
    }));

    act(() => result.current.moveTeamOrder("team-1", "up"));
    expect(result.current.teamOrder).toEqual([]);
    expect(result.current.isTeamsDirty).toBe(false);

    act(() => result.current.moveTeamOrder("team-1", "down"));
    expect(result.current.teamOrder).toEqual(["team-2", "team-1", "team-3"]);
    expect(result.current.isTeamsDirty).toBe(true);

    data = reorderActiveData(orderedActiveData, ["team-1", "team-3", "team-2"], '"remote-order"');
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(result.current.hasTeamDraftConflict).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("discards local team drafts when adopting the remote version", () => {
    let data = orderedActiveData;
    const { result, rerender } = renderHook(() => useGuildWarActiveController({
      selectedEventId: "event-1",
      activeData: data,
      guildWarService: createGuildWarService(vi.fn()),
      showError: vi.fn(),
    }));

    act(() => {
      result.current.setTeamDraftNames({ "team-1": "Local name" });
      result.current.setTeamDraftNotes({ "team-2": "Local note" });
      result.current.setTeamDraftLocks({ "team-3": true });
      result.current.moveTeamOrder("team-1", "down");
    });
    data = {
      ...reorderActiveData(orderedActiveData, ["team-1", "team-3", "team-2"], '"remote"'),
      teams: reorderActiveData(orderedActiveData, ["team-1", "team-3", "team-2"], '"remote"').teams
        .map((team) => team.id === "team-1" ? { ...team, team_name: "Remote name" } : team),
    };
    rerender();
    expect(result.current.hasTeamDraftConflict).toBe(true);

    act(() => result.current.acceptRemoteTeamChanges());

    expect(result.current.teamDraftNames).toEqual({});
    expect(result.current.teamDraftNotes).toEqual({});
    expect(result.current.teamDraftLocks).toEqual({});
    expect(result.current.teamOrder).toEqual([]);
    expect(result.current.hasTeamDraftConflict).toBe(false);
    expect(result.current.isTeamsDirty).toBe(false);
  });

  it("rebases local drafts onto the latest server version and retries with its ETag", async () => {
    const persist = vi.fn().mockResolvedValue({ ok: true });
    let data = orderedActiveData;
    const { result, rerender } = renderHook(() => useGuildWarActiveController({
      selectedEventId: "event-1",
      activeData: data,
      guildWarService: createGuildWarService(persist),
      showError: vi.fn(),
    }));

    act(() => {
      result.current.setTeamDraftNames({ "team-1": "Local name" });
      result.current.moveTeamOrder("team-1", "down");
    });
    data = {
      ...reorderActiveData(orderedActiveData, ["team-1", "team-3", "team-2"], '"latest-etag"'),
      teams: reorderActiveData(orderedActiveData, ["team-1", "team-3", "team-2"], '"latest-etag"').teams
        .map((team) => team.id === "team-1" ? { ...team, team_name: "Remote name" } : team),
    };
    rerender();
    expect(result.current.hasTeamDraftConflict).toBe(true);

    act(() => result.current.retryLocalTeamChanges());

    expect(result.current.teamDraftNames).toEqual({ "team-1": "Local name" });
    expect(result.current.teamOrder).toEqual(["team-2", "team-1", "team-3"]);
    expect(result.current.hasTeamDraftConflict).toBe(false);
    expect(result.current.isTeamsDirty).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      etag: '"latest-etag"',
      teamDraftNames: { "team-1": "Local name" },
      teams: [
        expect.objectContaining({ id: "team-2" }),
        expect.objectContaining({ id: "team-1" }),
        expect.objectContaining({ id: "team-3" }),
      ],
    }));
  });
});
