// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventsEditorController } from "./useEventsEditorController";

const beforeUnloadPromptMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@mantine/modals", () => ({
  modals: {
    openConfirmModal: vi.fn(),
  },
}));

vi.mock("../../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: beforeUnloadPromptMock,
}));

describe("useEventsEditorController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not arm beforeunload until the editor is actually edited", () => {
    const { result } = renderHook(() =>
      useEventsEditorController({
        sortedEvents: [],
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
});
