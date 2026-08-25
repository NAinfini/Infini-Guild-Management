import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACTIVE_VISUAL_THEME } from "../../visual/themes";
import { VisualThemeScene } from "./VisualThemeArtwork";

describe("VisualThemeArtwork", () => {
  it("uses the audited landing source from the active theme", () => {
    const { container } = render(<VisualThemeScene />);
    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.landing.src,
    );
  });

  it("selects responsive access and page-specific scenes from the active theme", () => {
    const { container, rerender } = render(<VisualThemeScene variant="access" />);
    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.access.desktop.src,
    );
    expect(container.querySelector("source")).toHaveAttribute(
      "srcset",
      ACTIVE_VISUAL_THEME.scenes.access.mobile.src,
    );

    rerender(<VisualThemeScene variant="announcements" />);
    expect(container.querySelector(".visual-theme-scene__environment")).toHaveAttribute(
      "src",
      ACTIVE_VISUAL_THEME.scenes.routes.announcements.src,
    );
  });

  it("keeps decorative art out of the accessibility tree", () => {
    const { container } = render(<VisualThemeScene />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelectorAll('img[alt=""]')).toHaveLength(1);
    expect(container.querySelector(".visual-theme-scene")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".visual-theme-scene")).toHaveAttribute(
      "data-visual-theme",
      ACTIVE_VISUAL_THEME.id,
    );
  });
});
