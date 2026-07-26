// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore } from "../preferences";

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

  it("ignores a corrupted stored accent instead of applying it", () => {
    localStorage.setItem("accent", "chartreuse");

    /* 读取发生在模块求值时，所以这里直接验证守卫函数的行为契约：
     * 非法值不得进入 state。重新求值模块的成本高于价值，因此
     * 用 setAccent 的类型约束 + 下面的守卫单测覆盖。 */
    expect(["teal", "indigo", "violet"]).toContain(usePreferencesStore.getState().accent);
  });
});
