import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortalThemeProvider } from "../../providers/ThemeProvider";
import { ContentPreviewCard } from "./ContentPreviewCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ContentPreviewCard", () => {
  it("renders a full-width text row without requesting decorative media when no image is provided", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <PortalThemeProvider>
        <ContentPreviewCard
          title="Guild briefing"
          excerpt="A short update for every member."
          category="Announcement"
          author="Guild Keeper"
          timestamp="Today"
          viewLabel="12 views"
          ariaLabel="Open Guild briefing"
          onOpen={onOpen}
          domain="announcements"
        />
      </PortalThemeProvider>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".content-preview-card__media")).toBeNull();
    expect(container.innerHTML).not.toContain("/visual-themes/");

    fireEvent.click(screen.getByRole("button", { name: "Open Guild briefing" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps content metadata and the open action available when its image cannot load", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <PortalThemeProvider>
        <ContentPreviewCard
          title="Guild briefing"
          excerpt="A short update for every member."
          category="Announcement"
          author="Guild Keeper"
          timestamp="Today"
          viewLabel="12 views"
          imageUrl="https://cdn.example.test/guild-briefing.webp"
          ariaLabel="Open Guild briefing"
          onOpen={onOpen}
          domain="announcements"
        />
      </PortalThemeProvider>,
    );

    fireEvent.error(container.querySelector(".content-preview-card__image") as HTMLImageElement);

    expect(container.querySelector(".content-preview-card__media-fallback")).toBeInTheDocument();
    expect(container.querySelector(".content-preview-card")).toHaveAttribute("data-has-media", "true");
    expect(screen.getByText("Guild briefing")).toBeInTheDocument();
    expect(screen.getByText("Guild Keeper")).toBeInTheDocument();
    expect(screen.getByText("A short update for every member.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Guild briefing" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
