// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildMediaGalleryLabels, MediaGallery } from "./MediaGallery";

vi.mock("@mantine/carousel", () => ({
  Carousel: Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Slide: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    },
  ),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: () => false,
}));

describe("MediaGallery", () => {
  it("localizes image and video alt text while interpolating each item index once", () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) => {
      if (key === "media.aria.openItem") return `Open media item ${options?.index}`;
      if (key === "media.aria.imageAlt") return `Localized media image ${options?.index}`;
      if (key === "media.aria.imageThumbnailAlt") return `Localized media thumbnail ${options?.index}`;
      if (key === "media.aria.videoThumbnailAlt") return `Localized video thumbnail ${options?.index}`;
      return key;
    });

    render(
      <MantineProvider>
        <MediaGallery
          images={["/raid-one.jpg", "/raid-two.jpg"]}
          videos={["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]}
          labels={labels}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "Open media item 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open media item 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open media item 3" })).toBeInTheDocument();
    expect(screen.getByAltText("Localized media image 1")).toBeInTheDocument();
    expect(screen.getByAltText("Localized media image 2")).toBeInTheDocument();
    expect(screen.getByAltText("Localized media thumbnail 1")).toBeInTheDocument();
    expect(screen.getByAltText("Localized media thumbnail 2")).toBeInTheDocument();
    expect(screen.getByAltText("Localized video thumbnail 3")).toBeInTheDocument();
    expect(screen.getByTitle("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(screen.queryByRole("button", { name: /\{\{index\}\}/ })).not.toBeInTheDocument();
  });
});
