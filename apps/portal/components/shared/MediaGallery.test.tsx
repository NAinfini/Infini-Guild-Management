import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMediaGalleryLabels, MediaGallery } from "./MediaGallery";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { index?: number }) =>
      key === "media.aria.openItem" ? `Open item ${options?.index}` : key,
  }),
}));

const MEDIA_ID_ONE = "abcdefghijklmnopqrstu";
const MEDIA_ID_TWO = "bcdefghijklmnopqrstuv";
const MEDIA_ID_THREE = "cdefghijklmnopqrstuvw";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaGallery", () => {
  it("localizes image and video alt text while interpolating each item index once", async () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) => {
      if (key === "media.aria.openItem") return `Open media item ${options?.index}`;
      if (key === "media.aria.imageAlt") return `Localized media image ${options?.index}`;
      if (key === "media.aria.imageThumbnailAlt") return `Localized media thumbnail ${options?.index}`;
      if (key === "media.aria.videoThumbnailAlt") return `Localized video thumbnail ${options?.index}`;
      return key;
    });

    render(
      <MediaGallery
        images={[MEDIA_ID_ONE, MEDIA_ID_TWO]}
        videos={["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]}
        labels={labels}
      />,
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
      <MediaGallery images={[MEDIA_ID_ONE]} videos={[embeddedVideo, directVideo]} />,
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
      <MediaGallery images={[MEDIA_ID_ONE, MEDIA_ID_TWO, MEDIA_ID_THREE]} labels={labels} />,
    );

    /* 幻灯片全都在 DOM 里但被挪出了视口，懒加载因此永远不会替它们开工——每次
       翻页都得现下载。当前这张和它的邻居必须直接取。 */
    expect(screen.getByAltText("Slide 1")).toHaveAttribute("loading", "eager");
    expect(screen.getByAltText("Slide 1")).toHaveAttribute("fetchpriority", "high");
    expect(screen.getByAltText("Slide 2")).toHaveAttribute("loading", "eager");
    /* 隔着一张的仍旧懒加载，否则一打开就把整本相册拉下来。 */
    expect(screen.getByAltText("Slide 3")).toHaveAttribute("loading", "lazy");
  });

  it("opens the enlarged view on the image the viewer clicked", async () => {
    const labels = buildMediaGalleryLabels((key, options?: { index?: number }) => {
      if (key === "media.aria.enlargeImage") return `Enlarge ${options?.index}`;
      if (key === "media.aria.openItem") return `Open item ${options?.index}`;
      if (key === "media.aria.imageAlt") return `Slide ${options?.index}`;
      return key;
    });

    render(<MediaGallery images={[MEDIA_ID_ONE, MEDIA_ID_TWO]} labels={labels} />);

    await userEvent.click(screen.getByRole("button", { name: "Open item 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Enlarge 2" }));

    const enlarged = within(await screen.findByRole("dialog")).getByAltText("Slide 2");
    expect(enlarged.getAttribute("src")).toMatch(
      new RegExp(`/api/media/${encodeURIComponent(MEDIA_ID_TWO)}/full$`),
    );
  });
});
