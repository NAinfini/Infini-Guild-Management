import { Button, Modal, Tooltip } from "@mantine/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes both mode and accent onto the document element", () => {
    usePreferencesStore.getState().setThemeMode("dark");
    usePreferencesStore.getState().setAccent("indigo");

    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("indigo");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
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

  it("gives every tooltip the shared surface and arrow without per-call props", () => {
    /* 调用点只写 label。箭头和浮层材质必须由主题给，否则每个页面各写各的，
     * 站内就会出现好几种提示长相。 */
    const { container } = render(
      <PortalThemeProvider>
        <Tooltip label="Lease expires at 03:00" opened>
          <span>held</span>
        </Tooltip>
      </PortalThemeProvider>,
    );

    const tooltip = screen.getByText("Lease expires at 03:00");

    expect(tooltip.className).toContain("tooltip");
    expect(container.ownerDocument.querySelector(".mantine-Tooltip-arrow")).not.toBeNull();
  });

  it("holds a tooltip closed until the pointer actually rests on the trigger", () => {
    /* 密集表格里鼠标一路扫过去，没有这段延迟就会串起一排提示。 */
    vi.useFakeTimers();

    render(
      <PortalThemeProvider>
        <Tooltip label="Locked until 04:00">
          <span>status</span>
        </Tooltip>
      </PortalThemeProvider>,
    );

    /* 断言看触发元素的 aria-describedby：它是「提示已经打开」的那一刻，
     * 而气泡本身还要等一帧过渡才落进 DOM，掐帧数会让这条断言变得不稳。 */
    const trigger = screen.getByText("status");
    fireEvent.mouseEnter(trigger);

    act(() => void vi.advanceTimersByTime(199));
    expect(trigger).not.toHaveAttribute("aria-describedby");

    act(() => void vi.advanceTimersByTime(1));
    expect(trigger).toHaveAttribute("aria-describedby");
  });
});
