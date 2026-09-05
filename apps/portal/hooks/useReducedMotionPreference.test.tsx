import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REDUCED_MOTION_MEDIA_QUERY, usePreferencesStore } from "../stores/preferences";
import { useMediaQuery } from "./useMediaQuery";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

vi.mock("./useMediaQuery", () => ({ useMediaQuery: vi.fn() }));

describe("useReducedMotionPreference", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
    vi.mocked(useMediaQuery).mockReturnValue(false);
  });

  it.each([
    { preference: "system", systemReduced: false, reduced: false },
    { preference: "system", systemReduced: true, reduced: true },
    { preference: "reduce", systemReduced: false, reduced: true },
    { preference: "reduce", systemReduced: true, reduced: true },
  ] as const)("resolves $preference with systemReduced=$systemReduced", ({ preference, systemReduced, reduced }) => {
    usePreferencesStore.getState().setMotionPreference(preference);
    vi.mocked(useMediaQuery).mockReturnValue(systemReduced);

    const { result } = renderHook(useReducedMotionPreference);

    expect(result.current).toBe(reduced);
    expect(useMediaQuery).toHaveBeenCalledWith(REDUCED_MOTION_MEDIA_QUERY);
  });

  it("updates mounted animation consumers when the saved preference changes", () => {
    const { result } = renderHook(useReducedMotionPreference);
    expect(result.current).toBe(false);

    act(() => usePreferencesStore.getState().setMotionPreference("reduce"));
    expect(result.current).toBe(true);

    act(() => usePreferencesStore.getState().setMotionPreference("system"));
    expect(result.current).toBe(false);
  });
});
