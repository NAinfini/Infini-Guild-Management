import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GalleryItem } from "@guild/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryGrid } from "./GalleryGrid";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (key === "aria.openImageBy") {
        return "Open image " + values?.name + ", uploaded by " + values?.uploader;
      }
      if (key === "aria.openVideoBy") {
        return "Open video " + values?.name + ", uploaded by " + values?.uploader;
      }
      if (key === "media.video") {
        return "VIDEO";
      }
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

    const emptyState = screen.getByText("empty.default").closest(".empty-state");
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "action.addMedia",
    }));

    expect(onAddMedia).toHaveBeenCalledOnce();
  });

  it("offers filter reset instead of media creation when filters hide all results", () => {
    const onAddMedia = vi.fn();
    const onResetFilters = vi.fn();
    renderEmptyGrid({ hasActiveFilters: true, onAddMedia, onResetFilters });

    const emptyState = screen.getByText("empty.default").closest(".empty-state");
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "action.addMedia",
    })).not.toBeInTheDocument();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
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
    caption: "First image",
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    created_at: "2026-07-29T00:00:00.000Z",
  },
  {
    id: "gallery-2",
    type: "image",
    media_id: "second1234567890abcde",
    url: null,
    caption: "Second image",
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    created_at: "2026-07-29T00:00:00.000Z",
  },
];

const mixedGalleryRows: GalleryItem[] = [
  galleryRows[0]!,
  {
    id: "gallery-youtube",
    type: "video",
    media_id: null,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    caption: "Raid recap",
    uploaded_by: "user-2",
    uploaded_by_name: "Officer",
    created_at: "2026-07-29T01:00:00.000Z",
  },
  {
    id: "gallery-vimeo",
    type: "video",
    media_id: null,
    url: "https://vimeo.com/123456789",
    caption: "Strategy review",
    uploaded_by: "user-3",
    uploaded_by_name: "Leader",
    created_at: "2026-07-29T02:00:00.000Z",
  },
];

function renderPopulatedGrid(rows: GalleryItem[] = mixedGalleryRows) {
  const onOpenLightbox = vi.fn();

  render(
    <GalleryGrid
        rows={rows}
        isLoading={false}
        isError={false}
        isExternalView={false}
        canModerate={false}
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
        onOpenLightbox={onOpenLightbox}
        resolveImageUrl={(key) => key}
        formatDateTime={(iso) => iso}
        actionDeleteLabel="action.delete"
    />,
  );

  return { onOpenLightbox };
}

describe("GalleryGrid CSS contract", () => {
  it("uses one container-aware row grid without masonry or viewport-fixed columns", () => {
    const galleryCssPath = resolve(
      process.cwd(),
      "apps/portal/components/pages/GalleryPage.css",
    );
    const galleryCss = readFileSync(galleryCssPath, "utf8");

    expect(galleryCss.match(/\.gallery-grid\s*\{/g)).toHaveLength(1);
    expect(galleryCss).toContain(
      "grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));",
    );
    expect(galleryCss).toMatch(/\.gallery-grid\s*\{[^}]*grid-auto-flow:\s*row;/s);
    expect(galleryCss).toMatch(/\.gallery-preview-media\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3;/s);
    expect(galleryCss).not.toMatch(/\bcolumn-count\s*:/);
  });
});

describe("GalleryGrid media layout", () => {
  it("keeps DOM and keyboard order aligned inside the row-first grid", async () => {
    const user = userEvent.setup();
    renderPopulatedGrid();

    const list = screen.getByRole("list", { name: "aria.galleryItems" });
    expect(list).toHaveClass("gallery-grid");

    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.getAttribute("data-gallery-id"))).toEqual([
      "gallery-1",
      "gallery-youtube",
      "gallery-vimeo",
    ]);

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
    const thumbnail = item!.querySelector(".gallery-preview-img");
    expect(thumbnail).toBeInstanceOf(HTMLImageElement);
    expect(thumbnail).toHaveAttribute(
      "src",
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
    expect(thumbnail).toHaveAttribute("alt", "");
    const badge = within(item!).getByText("VIDEO");
    expect(badge).toHaveClass("gallery-video-type-badge");
    expect(badge.parentElement).toHaveClass("gallery-preview-media");
  });

  it("keeps the localized video badge when a derived cover falls back", () => {
    renderPopulatedGrid();

    const item = screen.getAllByRole("listitem")[1]!;
    const thumbnail = item.querySelector(".gallery-preview-img") as HTMLImageElement;
    fireEvent.error(thumbnail);

    expect(item.querySelector(".gallery-preview-img")).not.toBeInTheDocument();
    expect(within(item).getByText("VIDEO")).toHaveClass("gallery-video-type-badge");
  });

  it("renders the same localized type badge when no video cover can be derived", () => {
    renderPopulatedGrid();

    const item = screen.getAllByRole("listitem")[2]!;
    expect(item.querySelector(".gallery-preview-img")).not.toBeInTheDocument();
    expect(within(item).getByText("VIDEO")).toHaveClass("gallery-video-type-badge");
  });

  it("gives every populated card the same stable media and content structure", () => {
    renderPopulatedGrid();

    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("gallery-grid__item");
      expect(item.querySelector(".gallery-card__inner > .gallery-preview-button > .gallery-preview-media"))
        .toBeInTheDocument();
      expect(item.querySelector(".gallery-card__inner > .gallery-card__footer"))
        .toBeInTheDocument();
    }
  });
});

describe("GalleryGrid item deletion", () => {
  it("shows progress only on the target card and ignores a repeated click", async () => {
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
          onOpenLightbox={vi.fn()}
          resolveImageUrl={(key) => key}
          formatDateTime={(iso) => iso}
          actionDeleteLabel="action.delete"
      />,
    );

    const cards = screen.getAllByRole("listitem");
    const firstDelete = within(cards[0]!).getByRole("button", { name: "action.delete" });
    const secondDelete = within(cards[1]!).getByRole("button", { name: "action.delete" });
    await user.click(firstDelete);

    expect(firstDelete).toHaveAttribute("data-loading", "true");
    expect(secondDelete).not.toHaveAttribute("data-loading", "true");
    await user.click(firstDelete);
    expect(onDelete).toHaveBeenCalledTimes(1);

    finishDelete();
    await waitFor(() => expect(firstDelete).not.toHaveAttribute("data-loading", "true"));
  });
});
