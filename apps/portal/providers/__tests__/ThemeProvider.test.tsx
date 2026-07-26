// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore } from "../../stores/preferences";
import { PortalThemeProvider, useTheme } from "../ThemeProvider";

function Probe() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="accent">{accent}</span>
      <button type="button" onClick={() => setTheme("dark")}>go dark</button>
      <button type="button" onClick={() => setAccent("violet")}>go violet</button>
    </div>
  );
}

describe("PortalThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.className = "";
  });

  it("writes both mode and accent onto the document element", () => {
    usePreferencesStore.getState().setThemeMode("dark");
    usePreferencesStore.getState().setAccent("indigo");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("indigo");
  });

  it("still writes the legacy .dark class, in lockstep with data-theme", () => {
    /* 兼容层，不是真相来源。88 处 `.dark` 选择器散在 13 个 CSS 文件里，
     * 要到 Task 7 才全部改成 [data-theme="dark"]；在那之前停写 `.dark`
     * 会让深色模式整体失效，违反「零行为变更」。
     * 这条断言的作用是钉住「两个信号必须同步」——半深半浅正是它们不同步的症状。
     * Task 7 删掉兼容写入后，这条改为断言 classList 里没有 "dark"。 */
    usePreferencesStore.getState().setThemeMode("dark");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps .dark in lockstep when the mode flips back to light", () => {
    usePreferencesStore.getState().setThemeMode("light");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads its state from the preferences store, not from localStorage directly", () => {
    /* 旧实现读的是 "theme-mode" 这个键。留着它不再有任何效果，
     * 说明 ThemeProvider 已经不再自己碰 localStorage。 */
    localStorage.setItem("theme-mode", "dark");
    usePreferencesStore.getState().setThemeMode("light");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("routes setTheme through the store so the choice survives a remount", () => {
    const { getByText, unmount } = render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.click(getByText("go dark"));
    expect(usePreferencesStore.getState().themeMode).toBe("dark");

    unmount();
    const second = render(<PortalThemeProvider><Probe /></PortalThemeProvider>);
    expect(second.getByTestId("theme").textContent).toBe("dark");
  });

  it("routes setAccent through the store", () => {
    const { getByText } = render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.click(getByText("go violet"));

    expect(usePreferencesStore.getState().accent).toBe("violet");
    expect(document.documentElement.dataset.accent).toBe("violet");
  });
});
