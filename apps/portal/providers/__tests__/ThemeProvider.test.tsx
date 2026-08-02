// @vitest-environment jsdom
import { Button, Modal } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
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
    document.documentElement.removeAttribute("data-input-modality");
    document.documentElement.className = "";
  });

  it("writes both mode and accent onto the document element", () => {
    usePreferencesStore.getState().setThemeMode("dark");
    usePreferencesStore.getState().setAccent("indigo");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("indigo");
  });

  it("no longer writes the legacy .dark class", () => {
    /* Task 7 迁完最后一批 .dark 选择器后兼容层已删除，
     * data-theme 成为唯一的模式信号。 */
    usePreferencesStore.getState().setThemeMode("dark");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("dark");
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

  it("tracks pointer and keyboard focus modality on the document", () => {
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.pointerDown(document.body);
    expect(document.documentElement.dataset.inputModality).toBe("pointer");

    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.documentElement.dataset.inputModality).toBe("keyboard");
  });

  it("gives modal close buttons a translated accessible name", () => {
    render(
      <PortalThemeProvider>
        <Modal opened onClose={() => undefined} title="Test dialog">
          Dialog content
        </Modal>
      </PortalThemeProvider>,
    );

    expect(
      screen.getByRole("button", { name: i18n.t("common:action.close") }),
    ).toBeInTheDocument();
  });

  it("pins brand filled buttons to the calibrated fill/ink pairs", () => {
    /* 静止态必须是 --brand-fill + --brand-on-fill，hover 态必须是
     * --brand-fill-hover + --brand-on-fill-hover。少钉 --button-bg 的话填色会退回
     * Mantine 的 primaryShade（6 档 = --brand-fill-hover），静止态就变成 900 墨压
     * 600 填色，实测 3.50 不过 AA——theme-tokens.test.ts:704 那条反向断言正是它。 */
    render(
      <PortalThemeProvider>
        <Button color="portal-brand" variant="filled">Join</Button>
      </PortalThemeProvider>,
    );

    const style = screen.getByRole("button", { name: "Join" }).getAttribute("style") ?? "";

    expect(style).toContain("--button-bg: var(--brand-fill)");
    expect(style).toContain("--button-hover: var(--brand-fill-hover)");
    expect(style).toContain("--button-color: var(--brand-on-fill)");
    expect(style).toContain("--button-hover-color: var(--brand-on-fill-hover)");
  });
});
