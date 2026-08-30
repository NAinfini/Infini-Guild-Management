import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@portal/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";

import { usePreferencesStore } from "../../stores/preferences";
import { PortalThemeProvider, useTheme } from "../ThemeProvider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Probe() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="accent">{accent}</span>
      <button type="button" onClick={() => setTheme("dark")}>go dark</button>
      <button type="button" onClick={() => setAccent("violet")}>go violet</button>
      <button type="button" onClick={toggleTheme}>toggle theme</button>
    </div>
  );
}

function DelayedTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button">status</button>}>
        Status
      </TooltipTrigger>
      <TooltipContent>Lease expires at 03:00</TooltipContent>
    </Tooltip>
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
    act(() => toast.close());
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

  it("routes accent and theme toggling through the shared preferences store", () => {
    const { getByText } = render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.click(getByText("go violet"));
    fireEvent.click(getByText("toggle theme"));

    expect(usePreferencesStore.getState().accent).toBe("violet");
    expect(usePreferencesStore.getState().themeMode).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("violet");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("tracks pointer and keyboard focus modality on the document", () => {
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.pointerDown(document.body);
    expect(document.documentElement.dataset.inputModality).toBe("pointer");

    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.documentElement.dataset.inputModality).toBe("keyboard");
  });

  it("supplies the shared toast manager", () => {
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    act(() => {
      toast.add({ title: "Saved", description: "Theme preference updated" });
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Theme preference updated")).toBeInTheDocument();
  });

  it("opens Base UI tooltips after the shared provider delay", async () => {
    const user = userEvent.setup();
    render(
      <PortalThemeProvider>
        <DelayedTooltip />
      </PortalThemeProvider>,
    );

    const trigger = screen.getByRole("button", { name: "status" });
    await user.hover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Lease expires at 03:00");
    });
  });
});
