// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
        deletePending={false}
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
