import type { WikiArticle, WikiCategory } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WikiArticleEditorCard } from "./WikiArticleEditorCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: () => <div data-testid="tiptap-editor" />,
}));

const category: WikiCategory = {
  id: "category-1",
  name: "Guides",
  slug: "guides",
  sort_order: 0,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

const article: WikiArticle = {
  id: "article-1",
  title: "Raid guide",
  slug: "raid-guide",
  category_id: category.id,
  body_json: '{"type":"doc","content":[]}',
  excerpt: "",
  sort_order: 0,
  pinned: false,
  view_count: 0,
  preview_media_id: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  updated_by_display_name: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

describe("WikiArticleEditorCard", () => {
  it("renders pending pin and archive intents as accessible switches", () => {
    const onTogglePinnedIntent = vi.fn();
    const onToggleArchiveIntent = vi.fn();

    render(
      <WikiArticleEditorCard
        navigation={<button type="button">Back</button>}
        canCreate
        canEdit
        canArchive
        canDelete
        isCreatingArticle={false}
        selectedArticle={article}
        selectedCategory={category}
        isLoading={false}
        articleTitle={article.title}
        articleBody={article.body_json}
        articleCategoryId={category.id}
        categoryOptions={[{ value: category.id, label: category.name }]}
        pinnedIntent="pin"
        archiveIntent="archive"
        isSaving={false}
        isCreating={false}
        isDeleting={false}
        isArchiving={false}
        canCreateArticle
        onArticleTitleChange={() => {}}
        onArticleBodyChange={() => {}}
        onArticleCategoryChange={() => {}}
        onSaveArticle={() => {}}
        onTogglePinnedIntent={onTogglePinnedIntent}
        onToggleArchiveIntent={onToggleArchiveIntent}
        onCreateArticle={() => {}}
        onExitEditor={() => {}}
        onImageUpload={async () => ""}
        onDeleteArticle={() => {}}
        emptyTitle="No article"
      />,
    );

    const pinSwitch = screen.getByRole("switch", { name: "articleEditor.pin" });
    const archiveSwitch = screen.getByRole("switch", { name: "articleEditor.archive" });
    expect(pinSwitch).toBeChecked();
    expect(archiveSwitch).toBeChecked();
    expect(screen.getByText("articleEditor.pinQueued")).toBeInTheDocument();
    expect(screen.getByText("articleEditor.archiveQueued")).toBeInTheDocument();

    fireEvent.click(pinSwitch);
    fireEvent.click(archiveSwitch);
    expect(onTogglePinnedIntent).toHaveBeenCalledOnce();
    expect(onToggleArchiveIntent).toHaveBeenCalledOnce();
  });
});
