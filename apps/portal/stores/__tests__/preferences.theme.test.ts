import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveThemeMode, usePreferencesStore } from "../preferences";

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

describe("preferences store: theme, motion, and accent", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
  });

  it.each(["system", "light", "dark"] as const)("persists and restores the %s theme preference", async (mode) => {
    usePreferencesStore.getState().setThemeMode(mode);

    expect(usePreferencesStore.getState().themeMode).toBe(mode);
    expect(localStorage.getItem("themeMode")).toBe(mode);
    expect((await importFreshPreferencesModule()).usePreferencesStore.getState().themeMode).toBe(mode);
  });

  it("defaults theme and motion to following the system", async () => {
    const fresh = await importFreshPreferencesModule();

    expect(fresh.usePreferencesStore.getState()).toMatchObject({ themeMode: "system", motionPreference: "system" });
  });

  it.each(["system", "reduce"] as const)("persists and restores the %s motion preference", async (preference) => {
    usePreferencesStore.getState().setMotionPreference(preference);

    expect(usePreferencesStore.getState().motionPreference).toBe(preference);
    expect(localStorage.getItem("motionPreference")).toBe(preference);
    expect((await importFreshPreferencesModule()).usePreferencesStore.getState().motionPreference).toBe(preference);
  });

  it("ignores invalid stored theme and motion preferences", async () => {
    localStorage.setItem("themeMode", "unsupported");
    localStorage.setItem("motionPreference", "full");

    const fresh = await importFreshPreferencesModule();

    expect(fresh.usePreferencesStore.getState()).toMatchObject({ themeMode: "system", motionPreference: "system" });
  });

  it("persists the accent", () => {
    usePreferencesStore.getState().setAccent("violet");

    expect(usePreferencesStore.getState().accent).toBe("violet");
    expect(localStorage.getItem("accent")).toBe("violet");
  });

  it("defaults the accent to teal", () => {
    expect(usePreferencesStore.getState().accent).toBe("teal");
  });

  it("clears saved appearance preferences and returns to system defaults on reset", () => {
    usePreferencesStore.getState().setThemeMode("dark");
    usePreferencesStore.getState().setMotionPreference("reduce");
    usePreferencesStore.getState().setAccent("indigo");

    usePreferencesStore.getState().resetPreferences();

    expect(localStorage.getItem("themeMode")).toBeNull();
    expect(localStorage.getItem("motionPreference")).toBeNull();
    expect(localStorage.getItem("accent")).toBeNull();
    expect(usePreferencesStore.getState().accent).toBe("teal");
    expect(usePreferencesStore.getState().themeMode).toBe("system");
    expect(usePreferencesStore.getState().motionPreference).toBe("system");
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

describe("resolveThemeMode", () => {
  it.each([
    { mode: "system", systemDark: false, resolved: "light" },
    { mode: "system", systemDark: true, resolved: "dark" },
    { mode: "light", systemDark: false, resolved: "light" },
    { mode: "light", systemDark: true, resolved: "light" },
    { mode: "dark", systemDark: false, resolved: "dark" },
    { mode: "dark", systemDark: true, resolved: "dark" },
  ] as const)("resolves $mode with systemDark=$systemDark to $resolved", ({ mode, systemDark, resolved }) => {
    expect(resolveThemeMode(mode, systemDark)).toBe(resolved);
  });
});
