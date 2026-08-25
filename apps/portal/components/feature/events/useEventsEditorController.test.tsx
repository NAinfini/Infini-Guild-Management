import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEventsEditorController } from "./useEventsEditorController";

const beforeUnloadPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: beforeUnloadPromptMock,
}));

describe("useEventsEditorController", () => {
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
