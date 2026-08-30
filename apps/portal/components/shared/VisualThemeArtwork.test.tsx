import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PortalThemeProvider } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import { ACTIVE_VISUAL_THEME } from "../../visual/themes";
import { VisualThemeScene } from "./VisualThemeArtwork";

beforeEach(() => {
  usePreferencesStore.setState({ themeMode: "light" });
});

describe("VisualThemeArtwork", () => {
  it("selects the active theme asset for landing and access variants", () => {
    const { container, rerender } = render(
      <PortalThemeProvider><VisualThemeScene /></PortalThemeProvider>,
    );
    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.landing.desktop.sources.light.src,
    );
    expect(container.querySelector("source")).toHaveAttribute(
      "srcset",
      ACTIVE_VISUAL_THEME.scenes.landing.mobile.sources.light.src,
    );

    rerender(
      <PortalThemeProvider><VisualThemeScene variant="access-login" /></PortalThemeProvider>,
    );
    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.access.login.desktop.sources.light.src,
    );
  });

  it("switches a route scene to its dark asset when the color mode changes", () => {
    const { container } = render(
      <PortalThemeProvider><VisualThemeScene variant="dashboard" /></PortalThemeProvider>,
    );

    act(() => usePreferencesStore.setState({ themeMode: "dark" }));

    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.routes.dashboard.sources.dark.src,
    );
    expect(container.querySelector(".visual-theme-scene")).toHaveAttribute(
      "data-visual-color-mode",
      "dark",
    );
  });

  it("keeps decorative scene artwork out of the accessibility tree", () => {
    const { container } = render(
      <PortalThemeProvider><VisualThemeScene /></PortalThemeProvider>,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector('img[alt=""]')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
