import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfigContext } from "motion/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@portal/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";

import { DARK_MODE_MEDIA_QUERY, REDUCED_MOTION_MEDIA_QUERY, usePreferencesStore } from "../../stores/preferences";
import { PortalThemeProvider, useTheme } from "../ThemeProvider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Probe() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();
  const motion = useContext(MotionConfigContext);

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="accent">{accent}</span>
      <span data-testid="motion">{motion.reducedMotion}</span>
      <span data-testid="motion-duration">{motion.transition?.duration ?? "default"}</span>
      <button type="button" onClick={() => setTheme("dark")}>go dark</button>
      <button type="button" onClick={() => setTheme("system")}>follow system</button>
      <button type="button" onClick={() => setAccent("violet")}>go violet</button>
      <button type="button" onClick={toggleTheme}>toggle theme</button>
    </div>
  );
}

function setSystemPreference(query: string, matches: boolean) {
  act(() => {
    const media = window.matchMedia(query);
    Object.assign(media, { matches });
    media.dispatchEvent(new Event("change"));
  });
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
    const mediaQueries = new Map<string, MediaQueryList>();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      let media = mediaQueries.get(query);
      if (!media) {
        media = Object.assign(new EventTarget(), {
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as MediaQueryList;
        mediaQueries.set(query, media);
      }
      return media;
    });
    localStorage.clear();
    usePreferencesStore.getState().resetPreferences();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-motion");
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

  it("follows system theme changes without replacing the saved system preference", () => {
    setSystemPreference(DARK_MODE_MEDIA_QUERY, true);
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");

    setSystemPreference(DARK_MODE_MEDIA_QUERY, false);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(usePreferencesStore.getState().themeMode).toBe("system");
    expect(localStorage.getItem("themeMode")).toBeNull();
  });

  it("keeps an explicit theme through OS changes and resumes following the system on request", () => {
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);
    fireEvent.click(screen.getByText("go dark"));

    setSystemPreference(DARK_MODE_MEDIA_QUERY, true);
    setSystemPreference(DARK_MODE_MEDIA_QUERY, false);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(usePreferencesStore.getState().themeMode).toBe("dark");

    fireEvent.click(screen.getByText("follow system"));
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(localStorage.getItem("themeMode")).toBe("system");
    setSystemPreference(DARK_MODE_MEDIA_QUERY, true);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("toggles from the resolved system theme into an explicit opposite theme", () => {
    setSystemPreference(DARK_MODE_MEDIA_QUERY, true);
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);

    fireEvent.click(screen.getByText("toggle theme"));

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(usePreferencesStore.getState().themeMode).toBe("light");
    expect(localStorage.getItem("themeMode")).toBe("light");
  });

  it("keeps CSS and MotionConfig aligned with live system and manual reduced-motion preferences", () => {
    render(<PortalThemeProvider><Probe /></PortalThemeProvider>);
    expect(document.documentElement.dataset.motion).toBe("full");
    expect(screen.getByTestId("motion")).toHaveTextContent("never");
    expect(screen.getByTestId("motion-duration")).toHaveTextContent("default");

    setSystemPreference(REDUCED_MOTION_MEDIA_QUERY, true);
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(screen.getByTestId("motion")).toHaveTextContent("always");
    expect(screen.getByTestId("motion-duration")).toHaveTextContent("0");

    setSystemPreference(REDUCED_MOTION_MEDIA_QUERY, false);
    expect(document.documentElement.dataset.motion).toBe("full");
    expect(screen.getByTestId("motion")).toHaveTextContent("never");
    expect(screen.getByTestId("motion-duration")).toHaveTextContent("default");

    act(() => usePreferencesStore.getState().setMotionPreference("reduce"));
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(screen.getByTestId("motion")).toHaveTextContent("always");
    expect(screen.getByTestId("motion-duration")).toHaveTextContent("0");

    setSystemPreference(REDUCED_MOTION_MEDIA_QUERY, true);
    act(() => usePreferencesStore.getState().setMotionPreference("system"));
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(screen.getByTestId("motion")).toHaveTextContent("always");

    setSystemPreference(REDUCED_MOTION_MEDIA_QUERY, false);
    expect(document.documentElement.dataset.motion).toBe("full");
    expect(screen.getByTestId("motion")).toHaveTextContent("never");
    expect(screen.getByTestId("motion-duration")).toHaveTextContent("default");
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
