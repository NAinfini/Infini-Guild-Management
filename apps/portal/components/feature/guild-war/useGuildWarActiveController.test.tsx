import type { GuildWarActiveResponse } from "@guild/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuildWarService } from "../../../services/GuildWarService";
import { useGuildWarActiveController } from "./useGuildWarActiveController";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  notifySuccess: vi.fn(),
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

vi.mock("../../../utils/notifications", () => ({
  notifySuccess: mocks.notifySuccess,
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
    mocks.confirm.mockReset();
    mocks.notifySuccess.mockReset();
  });

  it("saves dirty team metadata with the active ETag and blocks duplicate submissions", async () => {
    let resolveSave: ((value: { ok: true }) => void) | undefined;
    const persistTeamSnapshot = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderController(persistTeamSnapshot);

    act(() => {
      result.current.setTeamDraftNames({ "team-1": "Alpha Prime" });
    });
    expect(result.current.isTeamsDirty).toBe(true);

    let firstSave!: Promise<boolean>;
    let duplicateSave!: Promise<boolean>;
    act(() => {
      firstSave = result.current.handleSaveTeams();
      duplicateSave = result.current.handleSaveTeams();
    });

    await expect(duplicateSave).resolves.toBe(false);
    expect(persistTeamSnapshot).toHaveBeenCalledTimes(1);
    expect(persistTeamSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        teamDraftNames: { "team-1": "Alpha Prime" },
        etag: '"active-etag"',
      }),
    );

    await act(async () => {
      resolveSave?.({ ok: true });
      await expect(firstSave).resolves.toBe(true);
    });
    expect(mocks.notifySuccess).toHaveBeenCalledWith("message.teamsSaved");
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

  it("reports a localized save failure and releases the pending guard", async () => {
    const error = new Error("conflict");
    const persistTeamSnapshot = vi.fn().mockRejectedValue(error);
    const showError = vi.fn();
    const { result } = renderController(persistTeamSnapshot, showError);

    act(() => {
      result.current.setTeamDraftLocks({ "team-1": true });
    });

    await act(async () => {
      await expect(result.current.handleSaveTeams()).resolves.toBe(false);
    });
    expect(showError).toHaveBeenCalledWith(error, "message.teamsSaveFailed");
    expect(result.current.saveTeamsPending).toBe(false);
  });
});
