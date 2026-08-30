import type { WikiArticle } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { PortalThemeProvider } from "../../../providers/ThemeProvider";
import { WikiArticleListCard } from "./WikiArticleListCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) =>
      key === "aria.openArticle" ? `Open ${options?.title}` : key,
  }),
}));

const article = {
  id: "article-1",
  title: "Raid guide",
  slug: "raid-guide",
  category_id: "guides",
  body_json: "{}",
  sort_order: 0,
  pinned: false,
  archived_at: null,
  created_by: "guide-author",
  updated_by: null,
  updated_by_display_name: "Guide Author",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  preview_media_id: null,
  view_count: 8,
  excerpt: "Raid guide summary",
} satisfies WikiArticle;

function renderList(overrides: Partial<ComponentProps<typeof WikiArticleListCard>> = {}) {
  return render(
    <PortalThemeProvider>
      <WikiArticleListCard
        title="Articles"
        canCreateArticle={false}
        canManageCategories={false}
        createLabel="Create"
        onCreateArticle={vi.fn()}
        onOpenCategoryEditor={vi.fn()}
        categoryOptions={[{ value: "guides", label: "Guides" }]}
        hasActiveFilters={false}
        resetFiltersLabel="Reset"
        onResetFilters={vi.fn()}
        isLoading={false}
        isError={false}
        warningMessage="Load failed"
        articles={[]}
        selectedSlug={null}
        emptyTitle="No articles"
        onSelectArticle={vi.fn()}
        onRetry={vi.fn()}
        {...overrides}
      />
    </PortalThemeProvider>,
  );
}

describe("WikiArticleListCard", () => {
  it("renders the article catalog on an opaque card surface", () => {
    renderList();

    expect(screen.getByRole("region", { name: "Articles" })).toHaveAttribute("data-slot", "card");
  });

  it("offers retry in an error empty state when the first list load fails", () => {
    const onRetry = vi.fn();
    renderList({ isError: true, onRetry });

    expect(screen.getByText("Load failed").closest(".empty-state")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps cached articles visible and offers retry when refresh fails", () => {
    const onRetry = vi.fn();
    renderList({ articles: [article], isError: true, onRetry });

    expect(screen.getByRole("button", { name: "Open Raid guide" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
