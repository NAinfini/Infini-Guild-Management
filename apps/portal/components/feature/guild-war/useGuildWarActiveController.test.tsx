import type { GuildWarActiveResponse } from "@guild/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuildWarService } from "../../../services/GuildWarService";
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

function renderController(
  persistTeamSnapshot: GuildWarService["persistTeamSnapshot"],
  showError = vi.fn(),
) {
  return {
    showError,
    ...renderHook(() =>
      useGuildWarActiveController({
        selectedEventId: "event-1",
        activeData,
        guildWarService: { persistTeamSnapshot } as GuildWarService,
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
});
