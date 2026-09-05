import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PortalThemeProvider } from "../../providers/ThemeProvider";
import { usePreferencesStore } from "../../stores/preferences";
import { ACTIVE_VISUAL_THEME, VISUAL_WORKSPACE_SCENE_IDS } from "../../visual/themes";
import { VisualThemeScene } from "./VisualThemeArtwork";

beforeEach(() => {
  usePreferencesStore.setState({ themeMode: "light" });
});

describe("VisualThemeArtwork", () => {
  it.each(VISUAL_WORKSPACE_SCENE_IDS)("provides responsive day and night artwork for workspace %s", (scene) => {
    const assets = ACTIVE_VISUAL_THEME.scenes.workspace[scene];
    const { container } = render(
      <PortalThemeProvider><VisualThemeScene variant={`workspace-${scene}`} /></PortalThemeProvider>,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", assets.desktop.sources.light.src);
    expect(container.querySelector("source")).toHaveAttribute("srcset", assets.mobile.sources.light.src);
    expect(container.querySelector("source")).toHaveAttribute("media", "(max-width: 767px)");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    act(() => usePreferencesStore.setState({ themeMode: "dark" }));
    expect(container.querySelector("img")).toHaveAttribute("src", assets.desktop.sources.dark.src);
    expect(container.querySelector("source")).toHaveAttribute("srcset", assets.mobile.sources.dark.src);
  });

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

  it("switches a public scene to its dark asset when the color mode changes", () => {
    const { container } = render(
      <PortalThemeProvider><VisualThemeScene variant="access-register" /></PortalThemeProvider>,
    );

    act(() => usePreferencesStore.setState({ themeMode: "dark" }));

    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.access.register.desktop.sources.dark.src,
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
