// @vitest-environment jsdom
import type { GalleryItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GalleryGrid } from "./GalleryGrid";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
    <MantineProvider>
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
      />
    </MantineProvider>,
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
    url: "/gallery-1.webp",
    caption: "First image",
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    created_at: "2026-07-29T00:00:00.000Z",
  },
  {
    id: "gallery-2",
    type: "image",
    url: "/gallery-2.webp",
    caption: "Second image",
    uploaded_by: "user-1",
    uploaded_by_name: "Member",
    created_at: "2026-07-29T00:00:00.000Z",
  },
];

describe("GalleryGrid item deletion", () => {
  it("shows progress only on the target card and ignores a repeated click", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    const onDelete = vi.fn(() => new Promise<boolean>((resolve) => {
      finishDelete = () => resolve(true);
    }));

    render(
      <MantineProvider>
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
        />
      </MantineProvider>,
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
