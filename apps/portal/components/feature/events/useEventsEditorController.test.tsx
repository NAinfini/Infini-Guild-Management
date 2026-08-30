import { renderHook, act } from "@testing-library/react";
import type { Event } from "@guild/shared";
import { describe, expect, it, vi } from "vitest";
import { useEventsEditorController } from "./useEventsEditorController";

const beforeUnloadPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: beforeUnloadPromptMock,
}));

describe("useEventsEditorController", () => {
  it("retains the revision loaded for an edit and clears it for a new event", () => {
    const { result } = renderHook(() => useEventsEditorController({ attachmentSnapshot: "[]" }));
    const event: Event = {
      id: "event-1",
      type: "social",
      title: "Guild Run",
      description: null,
      start_at: "2026-08-10T12:00:00.000Z",
      end_at: null,
      capacity: null,
      pinned: false,
      signup_locked: false,
      auto_archive: false,
      auto_archived: false,
      visible_at: null,
      archived_at: null,
      created_by: "admin-1",
      updated_by: null,
      attachments: [],
      class_quotas: [],
      series_id: null,
      instance_date: null,
      winner_count: null,
      created_at: "2026-08-09T12:00:00.000Z",
      updated_at: "2026-08-09T12:00:00.001Z",
    };

    act(() => {
      result.current.openEditEditor(event);
    });
    expect(result.current.editingExpectedUpdatedAt).toBe(event.updated_at);

    act(() => {
      result.current.openCreateEditor();
    });
    expect(result.current.editingExpectedUpdatedAt).toBeNull();
  });

  it("does not arm beforeunload until the editor is actually edited", () => {
    const { result } = renderHook(() =>
      useEventsEditorController({
        attachmentSnapshot: "[]",
      }),
    );

    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(false);
    expect(result.current.isEditorDirty).toBe(false);

    act(() => {
      result.current.openCreateEditor();
    });

    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(false);
    expect(result.current.isEditorDirty).toBe(false);

    act(() => {
      result.current.setEditorTitle("Guild War");
    });

    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(true);
    expect(result.current.isEditorDirty).toBe(true);
  });

  it.each([
    ["setEditorPinned", true],
    ["setEditorSignupLocked", true],
  ] as const)("marks %s changes as touched so route navigation is blocked", (setter, value) => {
    const { result } = renderHook(() => useEventsEditorController({ attachmentSnapshot: "[]" }));

    act(() => {
      result.current.openCreateEditor();
      result.current[setter](value);
    });

    expect(result.current.isEditorDirty).toBe(true);
    expect(beforeUnloadPromptMock).toHaveBeenLastCalledWith(true);
  });
});
