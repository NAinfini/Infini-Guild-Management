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
  it("interpolates the item index exactly once in thumbnail accessible names", () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) => {
      if (key === "media.aria.openItem") return `Open media item ${options?.index}`;
      return key;
    });

    render(
      <MantineProvider>
        <MediaGallery images={["/raid-one.jpg", "/raid-two.jpg"]} videos={[]} labels={labels} />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "Open media item 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open media item 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /\{\{index\}\}/ })).not.toBeInTheDocument();
  });
});
