import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialogHost } from "@portal/components/shared/ConfirmDialogHost";
import type { ReactNode } from "react";
import { ApiRequestError } from "../../api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiPage } from "./WikiPage";

const controller = vi.hoisted(() => ({
  search: "",
  setSearch: vi.fn(),
  sortOrder: "curated" as "curated" | "updated_desc" | "updated_asc",
  setSortOrder: vi.fn(),
  archivedMode: "active" as "active" | "archived" | "all",
  setArchivedMode: vi.fn(),
  selectedCategoryId: undefined as string | undefined,
  setSelectedCategoryId: vi.fn(),
  categoriesQuery: { isError: false },
  articlesQuery: { isError: false, isLoading: false, isFetching: false, refetch: vi.fn() },
  pinnedQuery: { isError: false },
  detailQuery: { isError: false, isLoading: false, isFetching: false, error: null as unknown, refetch: vi.fn() },
  categories: [{ id: "guides", name: "Guides", slug: "guides", sort_order: 0 }],
  categoryOptions: [{ value: "guides", label: "Guides" }],
  articles: [
    {
      id: "article-1",
      title: "Raid guide",
      slug: "raid-guide",
      category_id: "guides",
      body_json: "{}",
      sort_order: 0,
      pinned: false,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: "Guide Author",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      preview_media_id: null,
      view_count: 8,
      excerpt: "Raid guide summary",
    },
  ],
  pinnedArticles: [
    {
      id: "pinned-1",
      title: "Pinned one",
      slug: "pinned-one",
      category_id: "guides",
      body_json: "{}",
      sort_order: 0,
      pinned: true,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: "Guide Author",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      preview_media_id: null,
      view_count: 1,
      excerpt: "Pinned one summary",
    },
    {
      id: "pinned-2",
      title: "Pinned two",
      slug: "pinned-two",
      category_id: "guides",
      body_json: "{}",
      sort_order: 1,
      pinned: true,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: "Guide Author",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      preview_media_id: null,
      view_count: 2,
      excerpt: "Pinned two summary",
    },
    {
      id: "pinned-3",
      title: "Pinned three",
      slug: "pinned-three",
      category_id: "guides",
      body_json: "{}",
      sort_order: 2,
      pinned: true,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: "Guide Author",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      preview_media_id: null,
      view_count: 3,
      excerpt: "Pinned three summary",
    },
  ],
  articlesHasMore: false,
  articlesLoadingMore: false,
  loadMoreArticles: vi.fn(),
  selectedArticle: null as null | {
    id: string;
    title: string;
    slug: string;
    category_id: string;
    body_json: string;
    sort_order: number;
    pinned: boolean;
    archived_at: string | null;
    created_by: string;
    updated_by: string | null;
    updated_by_display_name: string | null;
    created_at: string;
    updated_at: string;
    preview_media_id: string | null;
    view_count: number;
    excerpt: string;
  },
  selectedSlug: null as string | null,
  selectedCategory: null as null | { id: string; name: string; slug: string; sort_order: number },
  canManageContent: true,
  canViewNonPublicContent: true,
  canCreateArticle: true,
  canEditArticle: true,
  canArchiveArticle: true,
  canDeleteArticle: true,
  canManageCategories: true,
  isCreateRoute: false,
  isEditorPaneVisible: false,
  editorTab: "article" as "article" | "categories",
  isHistoryOpen: false,
  openHistory: vi.fn(),
  closeHistory: vi.fn(),
  articleEditor: {
    isCreatingArticle: false,
    articleTitle: "",
    setArticleTitle: vi.fn(),
    articleBody: "{}",
    setArticleBody: vi.fn(),
    articleCategoryId: "guides",
    setArticleCategoryId: vi.fn(),
    pinnedIntent: "none",
    archiveIntent: "none",
    isSaving: false,
    isCreating: false,
    isDeleting: false,
    isArchiving: false,
    canCreateArticle: true,
    saveSelectedArticle: vi.fn(),
    togglePinnedIntent: vi.fn(),
    toggleArchiveIntent: vi.fn(),
    createArticle: vi.fn(),
    uploadWikiArticleImage: vi.fn(),
    deleteArticle: vi.fn(),
    archiveArticle: vi.fn(),
  },
  categoryEditor: {
    categoryDrafts: [],
    isCreating: false,
    isSavingDrafts: false,
    canSaveDrafts: false,
    canRunDirectCommands: true,
    deletingCategoryId: null,
    createCategory: vi.fn(),
    saveCategoryDrafts: vi.fn(),
    setCategoryDraftName: vi.fn(),
    moveCategory: vi.fn(),
    deleteCategory: vi.fn(),
  },
  handleSelectArticle: vi.fn(),
  handleStartCreateArticle: vi.fn(),
  handleOpenArticleEditor: vi.fn(),
  handleOpenCategoryEditor: vi.fn(),
  handleExitArticleEditor: vi.fn(),
  handleCloseCategoryEditorWithoutSave: vi.fn(),
  handleDeleteCategory: vi.fn(),
  handleBackToList: vi.fn(),
}));

const defaultArticles = controller.articles.map((article) => ({ ...article }));
const defaultPinnedArticles = controller.pinnedArticles.map((article) => ({ ...article }));

vi.mock("../../hooks/useWikiPageController", () => ({
  useWikiPageController: () => controller,
}));

vi.mock("../../hooks/useLoadWarningToast", () => ({
  useLoadWarningToast: vi.fn(),
}));

vi.mock("@portal/components/shared/ContentFilterToolbar", () => ({
  ContentFilterGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContentFilterOption: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  ContentFilterToolbar: ({
    className,
    search,
    filterControls,
    onReset,
  }: {
    className?: string;
    search: ReactNode;
    filterControls: ReactNode;
    onReset: () => void;
  }) => (
    <section data-testid="wiki-filters" className={className}>
      {search}
      {filterControls}
      <button type="button" onClick={onReset}>toolbar reset filters</button>
    </section>
  ),
}));

vi.mock("@portal/components/shared/ContentPreviewCard", () => ({
  ContentPreviewCard: ({ title, onOpen }: { title: string; onOpen: () => void }) => (
    <button type="button" data-testid="pinned-wiki" onClick={onOpen}>{title}</button>
  ),
}));

vi.mock("../feature/wiki/WikiArticleListCard", () => ({
  WikiArticleListCard: ({
    articles,
    onSelectArticle,
    onCreateArticle,
    onOpenCategoryEditor,
    hasActiveFilters,
    resetFiltersLabel,
    onResetFilters,
  }: {
    articles: Array<{ slug: string; title: string }>;
    onSelectArticle: (slug: string) => void;
    onCreateArticle: () => void;
    onOpenCategoryEditor: () => void;
    hasActiveFilters: boolean;
    resetFiltersLabel: string;
    onResetFilters: () => void;
  }) => (
    <section data-testid="wiki-list">
      {articles.map((article) => (
        <button key={article.slug} type="button" onClick={() => onSelectArticle(article.slug)}>
          {article.title}
        </button>
      ))}
      <button type="button" onClick={onCreateArticle}>articleEditor.create</button>
      <button type="button" onClick={onOpenCategoryEditor}>editor.editCategories</button>
      {hasActiveFilters ? <button type="button" onClick={onResetFilters}>{resetFiltersLabel}</button> : null}
    </section>
  ),
}));

vi.mock("../feature/wiki/WikiCategoryEditorCard", () => ({
  WikiCategoryEditorCard: ({ navigation, onCloseEditor }: { navigation: ReactNode; onCloseEditor: () => void }) => (
    <section data-testid="wiki-category-editor">
      {navigation}
      <button type="button" onClick={onCloseEditor}>editor.closeNoSave</button>
    </section>
  ),
}));

vi.mock("../feature/wiki/WikiArticleEditorCard", () => ({
  WikiArticleEditorCard: ({ navigation, isCreatingArticle }: { navigation: ReactNode; isCreatingArticle: boolean }) => (
    <section data-testid="wiki-article-editor" data-creating={isCreatingArticle}>{navigation}</section>
  ),
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: () => <div data-testid="wiki-reader-content" />,
}));

vi.mock("../layout/PageLayout", () => ({
  PageLayout: ({
    children,
    toolbar,
    workspaceMode,
  }: {
    children: ReactNode;
    toolbar?: ReactNode;
    workspaceMode?: "scroll" | "contained";
  }) => (
    <div data-testid="page-layout" data-workspace-mode={workspaceMode}>
      <div data-testid="page-toolbar">{toolbar}</div>
      <div data-testid="page-workspace">{children}</div>
    </div>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage() {
  return render(<><WikiPage /><ConfirmDialogHost /></>);
}

async function openArticleMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "common:action.more" }));
  // jsdom 没有布局，Floating UI 可能隐藏已打开的浮层；仍使用真实菜单交互。
  return within(await screen.findByRole("menu", { hidden: true }));
}

describe("WikiPage", () => {
  beforeEach(() => {
    controller.search = "";
    controller.sortOrder = "curated";
    controller.archivedMode = "active";
    controller.selectedCategoryId = undefined;
    controller.selectedSlug = null;
    controller.selectedArticle = null;
    controller.selectedCategory = null;
    controller.isCreateRoute = false;
    controller.canManageContent = true;
    controller.canViewNonPublicContent = true;
    controller.canCreateArticle = true;
    controller.canEditArticle = true;
    controller.canArchiveArticle = true;
    controller.canDeleteArticle = true;
    controller.isEditorPaneVisible = false;
    controller.editorTab = "article";
    controller.articleEditor.isCreatingArticle = false;
    controller.articleEditor.isArchiving = false;
    controller.articleEditor.isDeleting = false;
    controller.articlesQuery = { isError: false, isLoading: false, isFetching: false, refetch: vi.fn() };
    controller.detailQuery = { isError: false, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
    controller.articles = defaultArticles.map((article) => ({ ...article }));
    controller.pinnedArticles = defaultPinnedArticles.map((article) => ({ ...article }));
    for (const value of Object.values(controller)) {
      if (typeof value === "function") value.mockReset?.();
    }
    for (const value of Object.values(controller.articleEditor)) {
      if (typeof value === "function") value.mockReset?.();
    }
    for (const value of Object.values(controller.categoryEditor)) {
      if (typeof value === "function") value.mockReset?.();
    }
  });

  it("renders the catalog with three pinned previews and a one-layer category rail", () => {
    renderPage();

    expect(screen.getByTestId("page-layout")).toHaveAttribute("data-workspace-mode", "scroll");
    expect(screen.getByTestId("page-toolbar")).toContainElement(screen.getByTestId("wiki-filters"));
    expect(screen.getAllByTestId("pinned-wiki")).toHaveLength(3);
    expect(screen.getByTestId("wiki-list")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "pinned.title" })).toBeInTheDocument();

    const rail = screen.getByRole("navigation");
    expect(within(rail as HTMLElement).getByRole("button", { name: "filter.allCategories" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(rail as HTMLElement).getByRole("button", { name: "Guides" }));
    expect(controller.setSelectedCategoryId).toHaveBeenCalledWith("guides");
  });

  it("renders every pinned item and hides the section when empty", () => {
    const pinnedArticles = [...controller.pinnedArticles];

    for (const count of [1, 2, 3]) {
      controller.pinnedArticles = pinnedArticles.slice(0, count);
      const { unmount } = renderPage();

      expect(screen.getAllByTestId("pinned-wiki")).toHaveLength(count);
      unmount();
    }

    controller.pinnedArticles = [];
    renderPage();
    expect(screen.queryByRole("region", { name: "pinned.title" })).not.toBeInTheDocument();
    controller.pinnedArticles = pinnedArticles;
  });

  it("does not repeat a pinned article in the catalog list", () => {
    controller.articles = [controller.pinnedArticles[0]!, ...controller.articles];

    renderPage();

    expect(within(screen.getByTestId("wiki-list")).queryByText("Pinned one")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("wiki-list")).getByText("Raid guide")).toBeInTheDocument();
  });

  it("hides the pinned section while filtering and keeps matching pinned articles in the results", () => {
    controller.search = "Pinned";
    controller.articles = [controller.pinnedArticles[0]!];

    renderPage();

    expect(screen.queryByTestId("pinned-wiki")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("wiki-list")).getByText("Pinned one")).toBeInTheDocument();
  });

  it("opens pinned and list previews through the independent article route handler", () => {
    renderPage();

    fireEvent.click(screen.getAllByTestId("pinned-wiki")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Raid guide" }));

    expect(controller.handleSelectArticle).toHaveBeenNthCalledWith(1, "pinned-one");
    expect(controller.handleSelectArticle).toHaveBeenNthCalledWith(2, "raid-guide");
  });

  it("resets catalog filters together", () => {
    controller.search = "raid";
    controller.archivedMode = "all";
    controller.sortOrder = "updated_asc";
    controller.selectedCategoryId = "guides";
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "action.resetFilters" }));
    expect(controller.setSearch).toHaveBeenCalledWith("");
    expect(controller.setArchivedMode).toHaveBeenCalledWith("active");
    expect(controller.setSelectedCategoryId).toHaveBeenCalledWith(undefined);
    expect(controller.setSortOrder).toHaveBeenCalledWith("curated");
  });

  it("resets only hidden conditions from the toolbar", () => {
    controller.search = "raid";
    controller.archivedMode = "all";
    controller.sortOrder = "updated_asc";
    controller.selectedCategoryId = "guides";
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "toolbar reset filters" }));
    expect(controller.setArchivedMode).toHaveBeenCalledWith("active");
    expect(controller.setSortOrder).toHaveBeenCalledWith("curated");
    expect(controller.setSearch).not.toHaveBeenCalled();
    expect(controller.setSelectedCategoryId).not.toHaveBeenCalled();
  });

  it("hides archived status from category-only managers", () => {
    controller.canManageContent = true;
    controller.canViewNonPublicContent = false;

    renderPage();

    expect(screen.queryByRole("radio", { name: "filter.status.archived" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "filter.sort.curated" })).toBeInTheDocument();
  });

  it.each([null, "preview-media"])("reads an article with preview %s and returns to the catalog", async (previewMediaId) => {
    controller.selectedSlug = "raid-guide";
    controller.selectedCategory = { id: "guides", name: "Guides", slug: "guides", sort_order: 0 };
    controller.selectedArticle = {
      ...controller.articles[0]!,
      preview_media_id: previewMediaId,
      view_count: 12,
      pinned: true,
    };
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Raid guide" })).toBeInTheDocument();
    expect(screen.getByText("Guide Author")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wiki-filters")).not.toBeInTheDocument();
    expect(await screen.findByTestId("wiki-reader-content")).toBeInTheDocument();
    expect(screen.getByText("articleEditor.pinned")).toBeInTheDocument();
    expect(screen.getByText("meta.lastEditor")).toBeInTheDocument();
    expect(screen.getByText("meta.updatedLabel")).toBeInTheDocument();
    expect(screen.getByText("meta.viewsLabel")).toBeInTheDocument();
    expect(document.querySelector(".content-detail-header data")).toHaveAttribute("value", "12");

    fireEvent.click(screen.getByRole("button", { name: "backToList" }));
    expect(controller.handleBackToList).toHaveBeenCalledOnce();
  });

  it("uses a safe last-editor fallback instead of exposing an internal user id", () => {
    controller.selectedSlug = "raid-guide";
    controller.selectedCategory = { id: "guides", name: "Guides", slug: "guides", sort_order: 0 };
    controller.selectedArticle = {
      ...controller.articles[0]!,
      created_by: "private-user-identifier",
      updated_by_display_name: null,
    };

    renderPage();

    expect(screen.getByText("meta.editorFallback")).toBeInTheDocument();
    expect(screen.queryByText("private-")).not.toBeInTheDocument();
  });

  it("uses the detail route for new articles and for the category editor", async () => {
    controller.isCreateRoute = true;
    controller.isEditorPaneVisible = true;
    controller.articleEditor.isCreatingArticle = true;
    const article = renderPage();

    expect(await screen.findByTestId("wiki-article-editor")).toHaveAttribute("data-creating", "true");
    expect(screen.getByTestId("wiki-article-editor")).toContainElement(
      screen.getByRole("button", { name: "backToList" }),
    );
    expect(screen.queryByTestId("wiki-list")).not.toBeInTheDocument();
    article.unmount();

    controller.isCreateRoute = false;
    controller.articleEditor.isCreatingArticle = false;
    controller.editorTab = "categories";
    renderPage();

    expect(screen.getByTestId("wiki-category-editor")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-category-editor")).toContainElement(
      screen.getByRole("button", { name: "backToList" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "editor.closeNoSave" }));
    expect(controller.handleCloseCategoryEditorWithoutSave).toHaveBeenCalledOnce();
  });

  it("returns to the catalog when a selected article was deleted", () => {
    controller.selectedSlug = "missing-article";
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new ApiRequestError("Missing", { status: 404 }),
      refetch: vi.fn(),
    };

    renderPage();

    expect(screen.getByText("common:notFound.title")).toBeInTheDocument();
    expect(screen.queryByText("welcome.title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "backToList" }));
    expect(controller.handleBackToList).toHaveBeenCalledOnce();
  });

  it("offers detail retry without turning a transport failure into the welcome state", () => {
    const refetch = vi.fn();
    controller.selectedSlug = "raid-guide";
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new Error("offline"),
      refetch,
    };

    renderPage();

    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    expect(screen.queryByText("welcome.title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("keeps cached article content visible and retries a refresh failure", () => {
    const refetch = vi.fn();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;
    controller.detailQuery = {
      isError: true,
      isLoading: false,
      isFetching: false,
      error: new Error("refresh failed"),
      refetch,
    };

    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Raid guide" })).toBeInTheDocument();
    expect(screen.getByText("common:loadError")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:action.retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows only archive in the menu for an archive-only role and waits for confirmation", async () => {
    const user = userEvent.setup();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;
    controller.canCreateArticle = false;
    controller.canEditArticle = false;
    controller.canArchiveArticle = true;
    controller.canDeleteArticle = false;

    renderPage();

    expect(screen.queryByRole("button", { name: "editor.editWiki" })).not.toBeInTheDocument();
    const menu = await openArticleMenu(user);
    expect(menu.getAllByRole("menuitem", { hidden: true })).toHaveLength(1);
    expect(menu.queryByRole("menuitem", { name: "history.button", hidden: true })).not.toBeInTheDocument();
    expect(menu.queryByRole("menuitem", { name: "common:action.delete", hidden: true })).not.toBeInTheDocument();
    await user.click(menu.getByRole("menuitem", { name: "articleEditor.archive", hidden: true }));
    const dialog = await screen.findByRole("alertdialog", { name: "confirm.archiveArticle.title" });
    expect(controller.articleEditor.archiveArticle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "articleEditor.archive" }));
    await waitFor(() => expect(controller.articleEditor.archiveArticle).toHaveBeenCalledOnce());
  });

  it("shows only delete in the menu for a delete-only role and waits for confirmation", async () => {
    const user = userEvent.setup();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;
    controller.canCreateArticle = false;
    controller.canEditArticle = false;
    controller.canArchiveArticle = false;
    controller.canDeleteArticle = true;

    renderPage();

    expect(screen.queryByRole("button", { name: "editor.editWiki" })).not.toBeInTheDocument();
    const menu = await openArticleMenu(user);
    expect(menu.getAllByRole("menuitem", { hidden: true })).toHaveLength(1);
    expect(menu.queryByRole("menuitem", { name: "history.button", hidden: true })).not.toBeInTheDocument();
    expect(menu.queryByRole("menuitem", { name: "articleEditor.archive", hidden: true })).not.toBeInTheDocument();
    const deleteItem = menu.getByRole("menuitem", { name: "common:action.delete", hidden: true });
    expect(deleteItem).toHaveAttribute("data-variant", "destructive");
    await user.click(deleteItem);
    const dialog = await screen.findByRole("alertdialog", { name: "confirm.deleteArticle.title" });
    expect(controller.articleEditor.deleteArticle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "common:action.delete" }));
    await waitFor(() => expect(controller.articleEditor.deleteArticle).toHaveBeenCalledOnce());
  });

  it("keeps edit as the primary button and exposes only history to an edit-only role", async () => {
    const user = userEvent.setup();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;
    controller.canArchiveArticle = false;
    controller.canDeleteArticle = false;

    renderPage();

    await user.click(screen.getByRole("button", { name: "editor.editWiki" }));
    expect(controller.handleOpenArticleEditor).toHaveBeenCalledOnce();
    const menu = await openArticleMenu(user);
    expect(menu.getAllByRole("menuitem", { hidden: true })).toHaveLength(1);
    await user.click(menu.getByRole("menuitem", { name: "history.button", hidden: true }));
    expect(controller.openHistory).toHaveBeenCalledOnce();
  });

  it.each([
    [false, null],
    [true, "2026-01-03T00:00:00.000Z"],
  ] as const)("omits an empty menu with archive permission %s and archived date %s", (canArchive, archivedAt) => {
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = { ...controller.articles[0]!, archived_at: archivedAt };
    controller.canEditArticle = false;
    controller.canArchiveArticle = canArchive;
    controller.canDeleteArticle = false;

    renderPage();

    expect(screen.queryByRole("button", { name: "common:action.more" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.editWiki" })).not.toBeInTheDocument();
  });

  it.each([
    ["isArchiving", "articleEditor.archive"],
    ["isDeleting", "common:action.delete"],
  ] as const)("disables the pending %s menu action", async (pendingState, actionLabel) => {
    const user = userEvent.setup();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;
    controller.articleEditor[pendingState] = true;

    renderPage();

    const menu = await openArticleMenu(user);
    const item = menu.getByRole("menuitem", { name: actionLabel, hidden: true });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("aria-busy", "true");
    fireEvent.click(item);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(controller.articleEditor.archiveArticle).not.toHaveBeenCalled();
    expect(controller.articleEditor.deleteArticle).not.toHaveBeenCalled();
  });

  it.each([
    ["articleEditor.archive", "confirm.archiveArticle.title"],
    ["common:action.delete", "confirm.deleteArticle.title"],
  ] as const)("cancels %s without mutating and returns focus to the menu trigger", async (actionLabel, dialogTitle) => {
    const user = userEvent.setup();
    controller.selectedSlug = "raid-guide";
    controller.selectedArticle = controller.articles[0]!;

    renderPage();

    const trigger = screen.getByRole("button", { name: "common:action.more" });
    const menu = await openArticleMenu(user);
    await user.click(menu.getByRole("menuitem", { name: actionLabel, hidden: true }));
    const dialog = await screen.findByRole("alertdialog", { name: dialogTitle });
    const cancel = within(dialog).getByRole("button", { name: "common:action.cancel" });
    expect(cancel).toHaveFocus();
    await user.click(cancel);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(controller.articleEditor.archiveArticle).not.toHaveBeenCalled();
    expect(controller.articleEditor.deleteArticle).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
