import { MantineProvider } from "@mantine/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMediaGalleryLabels, MediaGallery } from "./MediaGallery";

vi.mock("@mantine/carousel", () => ({
  Carousel: Object.assign(
    ({ children, emblaOptions }: { children: ReactNode; emblaOptions?: { duration?: number } }) => (
      <div data-testid="media-carousel" data-duration={emblaOptions?.duration}>{children}</div>
    ),
    {
      Slide: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    },
  ),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: () => false,
}));

const MEDIA_ID_ONE = "abcdefghijklmnopqrstu";
const MEDIA_ID_TWO = "bcdefghijklmnopqrstuv";
const MEDIA_ID_THREE = "cdefghijklmnopqrstuvw";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaGallery", () => {
  it("uses the measured snappy animation duration", () => {
    render(
      <MantineProvider>
        <MediaGallery images={[MEDIA_ID_ONE, MEDIA_ID_TWO]} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("media-carousel")).toHaveAttribute("data-duration", "18");
  });

  it("localizes image and video alt text while interpolating each item index once", async () => {
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
          images={[MEDIA_ID_ONE, MEDIA_ID_TWO]}
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
    await userEvent.click(screen.getByRole("button", { name: "Open media item 3" }));
    expect(screen.getByTitle("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(screen.queryByRole("button", { name: /\{\{index\}\}/ })).not.toBeInTheDocument();
  });

  it("mounts only the active player so leaving any video stops it", async () => {
    const embeddedVideo = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const directVideo = "https://cdn.example.com/raid.mp4";
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const { container } = render(
      <MantineProvider>
        <MediaGallery images={[MEDIA_ID_ONE]} videos={[embeddedVideo, directVideo]} />
      </MantineProvider>,
    );

    expect(container.querySelector("iframe, video")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open item 2" }));
    expect(screen.getByTitle(embeddedVideo)).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open item 3" }));
    expect(screen.queryByTitle(embeddedVideo)).not.toBeInTheDocument();
    expect(container.querySelector("video")).toHaveAttribute("src", directVideo);

    await userEvent.click(screen.getByRole("button", { name: "Open item 1" }));
    expect(container.querySelector("iframe, video")).not.toBeInTheDocument();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("holds the neighbouring slides ready so stepping through does not wait on the network", () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) =>
      key === "media.aria.imageAlt" ? `Slide ${options?.index}` : key,
    );

    render(
      <MantineProvider>
        <MediaGallery images={[MEDIA_ID_ONE, MEDIA_ID_TWO, MEDIA_ID_THREE]} labels={labels} />
      </MantineProvider>,
    );

    /* 幻灯片全都在 DOM 里但被挪出了视口，懒加载因此永远不会替它们开工——每次
       翻页都得现下载。当前这张和它的邻居必须直接取。 */
    expect(screen.getByAltText("Slide 1")).toHaveAttribute("loading", "eager");
    expect(screen.getByAltText("Slide 1")).toHaveAttribute("fetchpriority", "high");
    expect(screen.getByAltText("Slide 2")).toHaveAttribute("loading", "eager");
    /* 隔着一张的仍旧懒加载，否则一打开就把整本相册拉下来。 */
    expect(screen.getByAltText("Slide 3")).toHaveAttribute("loading", "lazy");
  });

  /*
   * 槽位是定高的，图片却是任意比例的。用 max-* 把图片收进槽位，两条边都不会被拉伸；
   * 写成 width/height: 100% 就不行——百分比高度要有一个确定的高度可依，槽位按内容
   * 排版时高度反过来取决于图片，浏览器只能当 auto 处理，图片按原始比例撑满宽度，
   * 超出的部分被 overflow: hidden 裁掉。
   */
  it("bounds the slide image instead of sizing it, so no ratio gets cropped or stretched", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/media-gallery.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const imageRule = styles.match(/\.infini-media-gallery-slide img\s*\{([^}]*)\}/)?.[1];

    expect(imageRule).toBeDefined();
    expect(imageRule).toMatch(/max-width:\s*100%/);
    expect(imageRule).toMatch(/max-height:\s*100%/);
    expect(imageRule).not.toMatch(/(^|;)\s*(width|height):/);
  });

  it("opens the enlarged view on the image the viewer clicked", async () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) => {
      if (key === "media.aria.enlargeImage") return `Enlarge ${options?.index}`;
      if (key === "media.aria.imageAlt") return `Slide ${options?.index}`;
      return key;
    });

    render(
      <MantineProvider>
        <MediaGallery images={[MEDIA_ID_ONE, MEDIA_ID_TWO]} labels={labels} />
      </MantineProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Enlarge 2" }));

    const enlarged = within(await screen.findByRole("dialog")).getByAltText("Slide 2");
    expect(enlarged).toHaveClass("infini-media-gallery-zoom-img");
    expect(enlarged.getAttribute("src")).toMatch(
      new RegExp(`/api/media/${encodeURIComponent(MEDIA_ID_TWO)}/full$`),
    );
  });
});
