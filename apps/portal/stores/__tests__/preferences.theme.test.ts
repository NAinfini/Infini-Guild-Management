import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "../preferences";

type PreferencesModule = typeof import("../preferences");

/*
 * The accent validation guard (`isAccent`) only runs once, at module
 * evaluation time, inside the zustand `create()` initializer. Setting
 * localStorage from within a test body — after that module has already
 * been evaluated — never exercises it; the store's `accent` field, once
 * initialized, is only otherwise touched by `setAccent`/`resetPreferences`,
 * neither of which re-reads storage. To actually exercise the guard we
 * have to force a fresh module evaluation with storage already primed.
 */
async function importFreshPreferencesModule(): Promise<PreferencesModule> {
  vi.resetModules();
  return import("../preferences");
}

describe("preferences store: theme mode and accent", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
  });

  it("persists the theme mode through the same channel as locale", () => {
    usePreferencesStore.getState().setThemeMode("dark");

    expect(usePreferencesStore.getState().themeMode).toBe("dark");
    expect(localStorage.getItem("themeMode")).toBe("dark");
  });

  it("persists the accent", () => {
    usePreferencesStore.getState().setAccent("violet");

    expect(usePreferencesStore.getState().accent).toBe("violet");
    expect(localStorage.getItem("accent")).toBe("violet");
  });

  it("defaults the accent to teal", () => {
    expect(usePreferencesStore.getState().accent).toBe("teal");
  });

  it("clears both on reset", () => {
    usePreferencesStore.getState().setThemeMode("dark");
    usePreferencesStore.getState().setAccent("indigo");

    usePreferencesStore.getState().resetPreferences();

    expect(localStorage.getItem("themeMode")).toBeNull();
    expect(localStorage.getItem("accent")).toBeNull();
    expect(usePreferencesStore.getState().accent).toBe("teal");
  });

  it("ignores a corrupted stored accent instead of applying it", async () => {
    localStorage.setItem("accent", "chartreuse");

    const fresh = await importFreshPreferencesModule();

    expect(fresh.usePreferencesStore.getState().accent).toBe("teal");
  });

  it("honours a valid stored accent on module init", async () => {
    localStorage.setItem("accent", "violet");

    const fresh = await importFreshPreferencesModule();

    expect(fresh.usePreferencesStore.getState().accent).toBe("violet");
  });
});
