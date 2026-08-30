import type { GalleryItem } from "@guild/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { GalleryLightboxModal } from "./GalleryLightboxModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => ({
      "modal.lightbox.title": "Gallery preview",
      "aria.prevItem": "Previous item",
      "aria.nextItem": "Next item",
      "aria.zoomOut": "Zoom out",
      "aria.zoomReset": "Reset zoom to 100%",
      "aria.zoomIn": "Zoom in",
      "common:action.close": "Close",
      "aria.like": "Like this item",
      "aria.unlike": "Remove your like",
      "aria.likeCount": `${values?.count} likes`,
      "action.editDetails": "Edit details",
      "common:action.save": "Save",
      "common:action.cancel": "Cancel",
      "field.title": "Title",
      "field.description": "Description",
      "field.optional": "Optional",
    })[key] ?? key,
  }),
}));

const item: GalleryItem = {
  id: "gallery-1",
  type: "image",
  media_id: "image1234567890abcdef",
  url: null,
  title: "Guild victory",
  description: "A clear night at the keep.",
  uploaded_by: "user-1",
  uploaded_by_name: "Member",
  like_count: 4,
  liked_by_viewer: false,
  created_at: "2026-07-29T00:00:00.000Z",
  revision_token: "revision-gallery-1",
};

function Harness({
  onToggleLike = vi.fn(async () => true),
  onPrev = vi.fn(),
  onNext = vi.fn(),
  canEdit = true,
  onUpdate = vi.fn(async () => true),
}: {
  onToggleLike?: (id: string, liked: boolean) => Promise<boolean>;
  onPrev?: () => void;
  onNext?: () => void;
  canEdit?: boolean;
  onUpdate?: (item: GalleryItem, input: { title: string; description: string | null }) => Promise<boolean>;
} = {}) {
  const [opened, setOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpened(true)}>
        Open gallery
      </button>
      <GalleryLightboxModal
        open={opened}
        item={opened ? item : null}
        index={0}
        total={1}
        zoom={1}
        onClose={() => setOpened(false)}
        onPrev={onPrev}
        onNext={onNext}
        setZoom={vi.fn()}
        resolveImageUrl={(value) => value}
        toEmbedVideoUrl={(value) => value}
        formatDateTime={() => "July 29"}
        canLike
        likePending={false}
        onToggleLike={onToggleLike}
        canEdit={canEdit}
        updatePending={false}
        onUpdate={onUpdate}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

describe("GalleryLightboxModal", () => {
  it("uses a labelled, focus-trapped dialog that closes with Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open gallery" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toContainElement(screen.queryByRole("banner"));
    expect(await screen.findByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Gallery preview" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("handles gallery navigation keys within the open dialog", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Harness onPrev={onPrev} onNext={onNext} />);

    await user.click(screen.getByRole("button", { name: "Open gallery" }));
    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    within(dialog).getByRole("button", { name: "Close" }).focus();

    await user.keyboard("{ArrowRight}{ArrowLeft}");

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it("keeps the title, description, author, and like control in the lightbox", async () => {
    const user = userEvent.setup();
    const onToggleLike = vi.fn(async () => true);
    render(<Harness onToggleLike={onToggleLike} />);
    await user.click(screen.getByRole("button", { name: "Open gallery" }));

    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    expect(within(dialog).getByText("Guild victory")).toBeInTheDocument();
    expect(within(dialog).getByText("A clear night at the keep.")).toBeInTheDocument();
    expect(within(dialog).getByText("Member")).toBeInTheDocument();
    const likeButton = within(dialog).getByRole("button", { name: "Like this item" });
    expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await user.click(likeButton);
    expect(onToggleLike).toHaveBeenCalledWith("gallery-1", false);
  });

  it("edits an existing item's title and description in the details panel", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn(async () => true);
    render(<Harness onUpdate={onUpdate} />);
    await user.click(screen.getByRole("button", { name: "Open gallery" }));

    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    await user.click(within(dialog).getByRole("button", { name: "Edit details" }));
    const title = within(dialog).getByRole("textbox", { name: "Title" });
    const description = within(dialog).getByRole("textbox", { name: "Description" });
    expect(title).toHaveValue("Guild victory");
    expect(description).toHaveValue("A clear night at the keep.");

    await user.clear(title);
    await user.type(title, "Guild celebration");
    await user.clear(description);
    await user.type(description, "At the moonlit keep.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(item, {
      title: "Guild celebration",
      description: "At the moonlit keep.",
    }));
    expect(within(dialog).queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });

  it("loads the selected full image when the lightbox opens", () => {
    const resolveImageUrl = vi.fn((value: string, variant?: "view" | "full") => (
      `/api/media/${value}/${variant ?? "view"}`
    ));

    render(
      <GalleryLightboxModal
        open
        item={item}
        index={0}
        total={1}
        zoom={1}
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        setZoom={vi.fn()}
        resolveImageUrl={resolveImageUrl}
        toEmbedVideoUrl={(value) => value}
        formatDateTime={() => "July 29"}
        canLike
        likePending={false}
        onToggleLike={vi.fn(async () => true)}
        canEdit
        updatePending={false}
        onUpdate={vi.fn(async () => true)}
        returnFocusRef={{ current: null }}
      />,
    );

    expect(resolveImageUrl).toHaveBeenCalledWith(item.media_id, "full");
    expect(screen.getByAltText("Guild victory")).toHaveAttribute(
      "src",
      `/api/media/${item.media_id}/full`,
    );
  });

  it("exposes image zoom as keyboard-operable controls", async () => {
    const user = userEvent.setup();
    const setZoom = vi.fn();
    render(
      <GalleryLightboxModal
        open
        item={item}
        index={0}
        total={1}
        zoom={1.12}
        onClose={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        setZoom={setZoom}
        resolveImageUrl={(value) => value}
        toEmbedVideoUrl={(value) => value}
        formatDateTime={() => "July 29"}
        canLike
        likePending={false}
        onToggleLike={vi.fn(async () => true)}
        canEdit
        updatePending={false}
        onUpdate={vi.fn(async () => true)}
        returnFocusRef={{ current: null }}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Gallery preview" });
    const zoomOut = within(dialog).getByRole("button", { name: "Zoom out" });
    const zoomReset = within(dialog).getByRole("button", { name: "Reset zoom to 100%" });
    const zoomIn = within(dialog).getByRole("button", { name: "Zoom in" });

    zoomOut.focus();
    await user.keyboard("{Enter}");
    await user.click(zoomReset);
    await user.click(zoomIn);

    expect(setZoom).toHaveBeenCalledTimes(3);
    expect(setZoom.mock.calls[1]?.[0]).toBe(1);
    expect(within(dialog).getByRole("status")).toHaveTextContent("112%");
    expect(within(dialog).getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("keeps gallery metadata available and retries a failed full-size image", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open gallery" }));

    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    fireEvent.error(within(dialog).getByAltText("Guild victory"));

    expect(within(dialog).getByText("common:media.imageUnavailable")).toBeInTheDocument();
    expect(within(dialog).getByText("Guild victory")).toBeInTheDocument();
    expect(within(dialog).getByText("A clear night at the keep.")).toBeInTheDocument();
    expect(within(dialog).getByText("Member")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "common:action.retry" }));
    expect(within(dialog).getByAltText("Guild victory")).toHaveAttribute(
      "src",
      expect.stringContaining("media_retry=1"),
    );
  });

});
