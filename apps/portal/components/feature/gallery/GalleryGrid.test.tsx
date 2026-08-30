import type { GalleryItem } from "@guild/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryGrid } from "./GalleryGrid";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === "aria.openImageBy") {
        return "Open image " + values?.name + ", uploaded by " + values?.uploader;
      }
      if (key === "aria.openVideoBy") {
        return "Open video " + values?.name + ", uploaded by " + values?.uploader;
      }
      if (key === "media.video") {
        return "VIDEO";
      }
      if (key === "aria.like") return "Like this item";
      if (key === "aria.unlike") return "Remove your like";
      if (key === "aria.likeCount") return `${values?.count} likes`;
      return key;
    },
  }),
}));

function renderEmptyGrid({
  hasActiveFilters,
  onAddMedia = vi.fn(),
  onResetFilters = vi.fn(),
}: {
  hasActiveFilters: boolean;
  onAddMedia?: () => void;
  onResetFilters?: () => void;
}) {
  render(
    <GalleryGrid
        rows={[]}
        isLoading={false}
        isError={false}
        isExternalView={false}
        canModerate={false}
        canLike={false}
        selectedIds={[]}
        emptyTitle="empty.default"
        errorTitle="empty.error"
        errorDescription="empty.errorDescription"
        retryLabel="action.retry"
        retryPending={false}
        hasActiveFilters={hasActiveFilters}
        canUpload
        resetFiltersLabel="action.resetFilters"
        addMediaLabel="action.addMedia"
        onRetry={vi.fn()}
        onResetFilters={onResetFilters}
        onAddMedia={onAddMedia}
        onToggleSelect={vi.fn()}
        onDelete={vi.fn()}
        onToggleLike={vi.fn()}
        onOpenLightbox={vi.fn()}
        resolveImageUrl={(key) => key}
        formatDateTime={(iso) => iso}
        actionDeleteLabel="action.delete"
    />,
  );
}

describe("GalleryGrid empty state", () => {
  it("offers media creation when the resource is globally empty", () => {
    const onAddMedia = vi.fn();
    renderEmptyGrid({ hasActiveFilters: false, onAddMedia });

    fireEvent.click(screen.getByRole("button", {
      name: "action.addMedia",
    }));

    expect(onAddMedia).toHaveBeenCalledOnce();
  });

  it("offers filter reset instead of media creation when filters hide all results", () => {
    const onAddMedia = vi.fn();
    const onResetFilters = vi.fn();
    renderEmptyGrid({ hasActiveFilters: true, onAddMedia, onResetFilters });

    expect(screen.queryByRole("button", {
      name: "action.addMedia",
    })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "action.resetFilters",
    }));

    expect(onResetFilters).toHaveBeenCalledOnce();
    expect(onAddMedia).not.toHaveBeenCalled();
  });
});

const galleryRows: GalleryItem[] = [
  {
    id: "gallery-1",
    type: "image",
    media_id: "image1234567890abcdef",
    url: null,
    title: "First image",
    description: "A bright guild victory.",
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    like_count: 3,
    liked_by_viewer: false,
    created_at: "2026-07-29T00:00:00.000Z",
    revision_token: "revision-gallery-1",
  },
  {
    id: "gallery-2",
    type: "image",
    media_id: "second1234567890abcde",
    url: null,
    title: "Second image",
    description: null,
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    like_count: 0,
    liked_by_viewer: false,
    created_at: "2026-07-29T00:00:00.000Z",
    revision_token: "revision-gallery-2",
  },
];

const mixedGalleryRows: GalleryItem[] = [
  galleryRows[0]!,
  {
    id: "gallery-youtube",
    type: "video",
    media_id: null,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Raid recap",
    description: "The final push.",
    uploaded_by: "user-2",
    uploaded_by_name: "Officer",
    like_count: 2,
    liked_by_viewer: false,
    created_at: "2026-07-29T01:00:00.000Z",
    revision_token: "revision-gallery-youtube",
  },
  {
    id: "gallery-vimeo",
    type: "video",
    media_id: null,
    url: "https://vimeo.com/123456789",
    title: "Strategy review",
    description: "Positioning notes.",
    uploaded_by: "user-3",
    uploaded_by_name: "Leader",
    like_count: 7,
    liked_by_viewer: true,
    created_at: "2026-07-29T02:00:00.000Z",
    revision_token: "revision-gallery-vimeo",
  },
];

function renderPopulatedGrid(
  rows: GalleryItem[] = mixedGalleryRows,
  options: { canLike?: boolean; onToggleLike?: (id: string, liked: boolean) => Promise<boolean> } = {},
) {
  const onOpenLightbox = vi.fn();

  render(
    <GalleryGrid
        rows={rows}
        isLoading={false}
        isError={false}
        isExternalView={false}
        canModerate={false}
        canLike={options.canLike ?? false}
        selectedIds={[]}
        emptyTitle="empty.default"
        errorTitle="empty.error"
        errorDescription="empty.errorDescription"
        retryLabel="action.retry"
        retryPending={false}
        hasActiveFilters={false}
        canUpload
        resetFiltersLabel="action.resetFilters"
        addMediaLabel="action.addMedia"
        onRetry={vi.fn()}
        onResetFilters={vi.fn()}
        onAddMedia={vi.fn()}
        onToggleSelect={vi.fn()}
        onDelete={vi.fn()}
        onToggleLike={options.onToggleLike ?? vi.fn(async () => true)}
        onOpenLightbox={onOpenLightbox}
        resolveImageUrl={(key) => key}
        formatDateTime={(iso) => iso}
        actionDeleteLabel="action.delete"
    />,
  );

  return { onOpenLightbox };
}

describe("GalleryGrid media behavior", () => {
  it("keeps preview actions in keyboard order", async () => {
    const user = userEvent.setup();
    renderPopulatedGrid();

    const list = screen.getByRole("list", { name: "aria.galleryItems" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    const previewButtons = items.map((item) => within(item).getByRole("button"));
    expect(previewButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open image First image, uploaded by Member",
      "Open video Raid recap, uploaded by Officer",
      "Open video Strategy review, uploaded by Leader",
    ]);

    await user.tab();
    expect(previewButtons[0]).toHaveFocus();
    await user.tab();
    expect(previewButtons[1]).toHaveFocus();
    await user.tab();
    expect(previewButtons[2]).toHaveFocus();
  });

  it("uses the existing derived cover for supported video URLs", () => {
    renderPopulatedGrid();

    const [imageItem, item] = screen.getAllByRole("listitem");
    expect(within(imageItem!).queryByText("VIDEO")).not.toBeInTheDocument();
    const thumbnail = item!.querySelector("img");
    expect(thumbnail).toBeInstanceOf(HTMLImageElement);
    expect(thumbnail).toHaveAttribute(
      "src",
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
    expect(thumbnail).toHaveAttribute("alt", "");
    expect(within(item!).getByText("VIDEO")).toBeInTheDocument();
  });

  it("keeps the localized video badge when a derived cover falls back", () => {
    renderPopulatedGrid();

    const item = screen.getAllByRole("listitem")[1]!;
    const thumbnail = item.querySelector("img") as HTMLImageElement;
    fireEvent.error(thumbnail);

    expect(item.querySelector("img")).not.toBeInTheDocument();
    expect(within(item).getByText("VIDEO")).toBeInTheDocument();
  });

  it("keeps image metadata and its open action available when a gallery thumbnail fails", () => {
    const { onOpenLightbox } = renderPopulatedGrid([galleryRows[0]!]);
    const item = screen.getByRole("listitem");
    fireEvent.error(item.querySelector("img") as HTMLImageElement);

    expect(within(item).getByText("First image")).toBeInTheDocument();
    expect(within(item).getByText("A bright guild victory.")).toBeInTheDocument();
    expect(within(item).getByText("Member")).toBeInTheDocument();

    fireEvent.click(within(item).getByRole("button", { name: "Open image First image, uploaded by Member" }));
    expect(onOpenLightbox).toHaveBeenCalledWith(
      "gallery-1",
      within(item).getByRole("button", { name: "Open image First image, uploaded by Member" }),
    );
  });

  it("renders the same localized type badge when no video cover can be derived", () => {
    renderPopulatedGrid();

    const item = screen.getAllByRole("listitem")[2]!;
    expect(item.querySelector("img")).not.toBeInTheDocument();
    expect(within(item).getByText("VIDEO")).toBeInTheDocument();
  });

  it("keeps gallery metadata available and toggles likes", async () => {
    const onToggleLike = vi.fn(async () => true);
    const user = userEvent.setup();
    renderPopulatedGrid(undefined, { canLike: true, onToggleLike });

    const first = screen.getAllByRole("listitem")[0]!;
    expect(within(first).getByText("First image")).toBeInTheDocument();
    expect(within(first).getByText("A bright guild victory.")).toBeInTheDocument();
    expect(within(first).getByText("Member")).toBeInTheDocument();

    const likeButton = within(first).getByRole("button", { name: "Like this item" });
    expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await user.click(likeButton);
    await waitFor(() => expect(onToggleLike).toHaveBeenCalledWith("gallery-1", false));
  });
});

describe("GalleryGrid item deletion", () => {
  it("ignores a repeated delete click while the first request is pending", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    const onDelete = vi.fn(() => new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true);
    }));

    render(
      <GalleryGrid
          rows={galleryRows}
          isLoading={false}
          isError={false}
          isExternalView={false}
          canModerate
          canLike={false}
          selectedIds={[]}
          emptyTitle="empty.default"
          errorTitle="empty.error"
          errorDescription="empty.errorDescription"
          retryLabel="action.retry"
          retryPending={false}
          hasActiveFilters={false}
          canUpload
          resetFiltersLabel="action.resetFilters"
          addMediaLabel="action.addMedia"
          onRetry={vi.fn()}
          onResetFilters={vi.fn()}
          onAddMedia={vi.fn()}
          onToggleSelect={vi.fn()}
          onDelete={onDelete}
          onToggleLike={vi.fn(async () => true)}
          onOpenLightbox={vi.fn()}
          resolveImageUrl={(key) => key}
          formatDateTime={(iso) => iso}
          actionDeleteLabel="action.delete"
      />,
    );

    const cards = screen.getAllByRole("listitem");
    const firstDelete = within(cards[0]!).getByRole("button", { name: "action.delete" });
    await user.click(firstDelete);

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "gallery-1" }));
    await user.click(firstDelete);
    expect(onDelete).toHaveBeenCalledTimes(1);

    finishDelete();
  });
});
