import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiPage } from "./WikiPage";

const navigateMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => ({ slug: "deleted-article" as string | undefined }));
const routeSearchMock = vi.hoisted(() => ({ selection: undefined as "none" | undefined }));
const confirmMock = vi.hoisted(() => vi.fn());
const resetCategoryDraftsMock = vi.hoisted(() => vi.fn());
const categoryEditorState = vi.hoisted(() => ({ isDirty: false }));
const articleEditorState = vi.hoisted(() => ({
  isDeleting: false,
  isCreatingArticle: false,
  isDirty: false,
}));
const mediaState = vi.hoisted(() => ({ isDesktop: true }));
const wikiEditorMock = vi.hoisted(() => vi.fn());
const categoryEditorMock = vi.hoisted(() => vi.fn());
const startCreateArticleMock = vi.hoisted(() => vi.fn());
const exitArticleEditorMock = vi.hoisted(() => vi.fn());
const permissionState = vi.hoisted(() => ({
  allowed: null as Set<string> | null,
}));
const serviceMocks = vi.hoisted(() => ({
  fetchWikiArticleBySlug: vi.fn(),
  fetchWikiArticles: vi.fn(),
  fetchWikiCategories: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsMock,
  useSearch: () => routeSearchMock,
}));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: (query: string) =>
    query.includes("min-width: 1200px") ? mediaState.isDesktop : false,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("../feature/wiki/WikiCategoryEditorCard", () => ({
  WikiCategoryEditorCard: ({
    onCreateCategory,
    onCloseEditor,
  }: {
    onCreateCategory: () => void;
    onCloseEditor: () => void;
  }) => (
    <div>
      <button type="button" onClick={onCreateCategory}>categoryEditor.create</button>
      <button type="button">articleEditor.save</button>
      <button type="button" onClick={onCloseEditor}>editor.closeNoSave</button>
    </div>
  ),
}));

vi.mock("../../services/WikiService", () => ({
  fetchWikiArticleBySlug: serviceMocks.fetchWikiArticleBySlug,
  fetchWikiArticles: serviceMocks.fetchWikiArticles,
  fetchWikiCategories: serviceMocks.fetchWikiCategories,
}));

vi.mock("../../hooks/useWikiArticleEditor", () => ({
  useWikiArticleEditor: wikiEditorMock,
}));

vi.mock("../../hooks/useWikiCategoryEditor", () => ({
  useWikiCategoryEditor: categoryEditorMock,
}));

vi.mock("../../hooks/useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: (permissions: string[]) => (
      permissionState.allowed === null
      || permissions.some((permission) => permissionState.allowed?.has(permission))
    ),
  }),
}));

vi.mock("../../hooks/useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("../../hooks/useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("../../hooks/useLoadWarningToast", () => ({
  useLoadWarningToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { category?: string }) =>
      key === "drawer.readerTitle"
        ? `Wiki / ${values?.category ?? "Category"}`
        : key,
  }),
}));

vi.mock("@portal/components/shared/TipTapEditor", () => ({
  TipTapEditor: () => <div data-testid="tiptap-editor" />,
  buildTipTapEditorLabels: () => ({}),
}));

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderWikiPage() {
  return render(<WikiPage />, { wrapper: createWrapper() });
}

describe("WikiPage", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 48),
    );
    navigateMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    resetCategoryDraftsMock.mockReset();
    startCreateArticleMock.mockReset();
    permissionState.allowed = null;
    categoryEditorState.isDirty = false;
    articleEditorState.isDeleting = false;
    articleEditorState.isCreatingArticle = false;
    articleEditorState.isDirty = false;
    mediaState.isDesktop = true;
    exitArticleEditorMock.mockReset();
    paramsMock.slug = "deleted-article";
    routeSearchMock.selection = undefined;
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }

    serviceMocks.fetchWikiCategories.mockResolvedValue([{ id: "category-1", name: "Guides", slug: "guides", sort_order: 0 }]);
    serviceMocks.fetchWikiArticles.mockResolvedValue({
      data: [
        {
          id: "article-1",
          title: "Kept Article",
          slug: "kept-article",
          category_id: "category-1",
          body_json: "{}",
          sort_order: 0,
          pinned: false,
          archived_at: null,
          created_by: "user-1",
          updated_by: null,
          updated_by_display_name: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      total_pages: 1,
    });
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue({
      id: "deleted-id",
      title: "Deleted Article",
      slug: "deleted-article",
      category_id: "category-1",
      body_json: "{}",
      sort_order: 0,
      pinned: false,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    categoryEditorMock.mockReturnValue({
      categoryName: "",
      categoryDrafts: [],
      isCreating: false,
      isSavingDrafts: false,
      canSaveDrafts: false,
      deletingCategoryId: null,
      setCategoryName: vi.fn(),
      createCategory: vi.fn(),
      saveCategoryDrafts: vi.fn(),
      setCategoryDraftName: vi.fn(),
      moveCategory: vi.fn(),
      deleteCategory: vi.fn(),
      resetCategoryDrafts: resetCategoryDraftsMock,
      get isDirty() {
        return categoryEditorState.isDirty;
      },
    });
    wikiEditorMock.mockReturnValue({
      articleTitle: "",
      setArticleTitle: vi.fn(),
      articleBody: "{}",
      setArticleBody: vi.fn(),
      articleSortOrder: 0,
      setArticleSortOrder: vi.fn(),
      articleCategoryId: "category-1",
      setArticleCategoryId: vi.fn(),
      pinnedIntent: "none",
      archiveIntent: "none",
      get isCreatingArticle() {
        return articleEditorState.isCreatingArticle;
      },
      get isDirty() {
        return articleEditorState.isDirty;
      },
      isSaving: false,
      isCreating: false,
      get isDeleting() {
        return articleEditorState.isDeleting;
      },
      canCreateArticle: true,
      startCreateArticle: startCreateArticleMock,
      exitEditor: exitArticleEditorMock,
      createArticle: vi.fn(),
      saveSelectedArticle: vi.fn(),
      togglePinnedIntent: vi.fn(),
      toggleArchiveIntent: vi.fn(),
      uploadWikiArticleImage: vi.fn(),
      deleteArticle: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests curated server order by default", async () => {
    renderWikiPage();

    await waitFor(() =>
      expect(serviceMocks.fetchWikiArticles).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "curated" }),
      ),
    );
  });

  it("opens mobile deep links in the article pane and returns to the list", async () => {
    mediaState.isDesktop = false;
    paramsMock.slug = undefined;
    routeSearchMock.selection = "none";
    const rendered = renderWikiPage();

    expect(screen.queryByRole("button", { name: "backToList" })).not.toBeInTheDocument();
    paramsMock.slug = "deleted-article";
    routeSearchMock.selection = undefined;
    rendered.rerender(<WikiPage />);

    const backButton = await screen.findByRole("button", { name: "backToList" });
    fireEvent.click(backButton);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "backToList" })).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Kept Article")).toBeInTheDocument();
  });

  it("exits create mode when browser history selects an article", async () => {
    startCreateArticleMock.mockImplementation(() => {
      articleEditorState.isCreatingArticle = true;
      articleEditorState.isDirty = true;
    });
    const rendered = renderWikiPage();

    fireEvent.click(await screen.findByRole("button", { name: "articleEditor.create" }));
    expect(startCreateArticleMock).toHaveBeenCalledOnce();

    paramsMock.slug = "history-article";
    routeSearchMock.selection = undefined;
    rendered.rerender(<WikiPage />);

    await waitFor(() => expect(exitArticleEditorMock).toHaveBeenCalledOnce());
  });

  it("clears the route instead of auto-selecting another article after article deletion", async () => {
    renderWikiPage();

    await waitFor(() => expect(wikiEditorMock).toHaveBeenCalled());
    const latestCall = wikiEditorMock.mock.calls.at(-1)?.[0];

    latestCall.onArticleCreated(null);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/wiki",
          replace: true,
          viewTransition: false,
        }),
      ),
    );
    const deleteNavigation = navigateMock.mock.calls.at(-1)?.[0];
    expect(deleteNavigation.search({ view: "external" })).toEqual({
      selection: "none",
      view: "external",
    });
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/wiki/$slug",
        params: { slug: "kept-article" },
      }),
    );
  });

  it("loads additional pages and replaces them when the pinned filter changes", async () => {
    paramsMock.slug = undefined;
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue(null);
    const article = (id: string, title: string, pinned: boolean) => ({
      id,
      title,
      slug: id,
      category_id: "category-1",
      body_json: "{}",
      sort_order: 0,
      pinned,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    serviceMocks.fetchWikiArticles.mockImplementation(
      async ({ page, pinned }: { page: number; pinned?: boolean }) => {
        if (pinned) {
          return {
            data: [article("pinned-article", "Pinned Article", true)],
            total: 1,
            page: 1,
            limit: 50,
            total_pages: 1,
          };
        }
        return {
          data: page === 1
            ? [article("page-one", "Page One", false)]
            : [article("page-two", "Page Two", false)],
          total: 2,
          page,
          limit: 1,
          total_pages: 2,
        };
      },
    );

    renderWikiPage();

    await screen.findByText("Page One");
    fireEvent.click(screen.getByRole("button", { name: "action.loadMore" }));
    await screen.findByText("Page Two");

    fireEvent.click(screen.getByRole("button", { name: "common:filter.toggle" }));
    const filterDialog = await screen.findByRole("dialog", { name: "common:filter.toggle" });
    fireEvent.click(within(filterDialog).getByRole("switch", { name: "filter.showPinned" }));

    await screen.findByText("Pinned Article");
    expect(screen.queryByText("Page One")).not.toBeInTheDocument();
    expect(screen.queryByText("Page Two")).not.toBeInTheDocument();
  });

  it("keeps category filters in the page toolbar instead of the article list card", async () => {
    renderWikiPage();

    const filterToggle = await screen.findByRole("button", { name: "common:filter.toggle" });
    fireEvent.click(filterToggle);
    const filterDialog = await screen.findByRole("dialog", { name: "common:filter.toggle" });
    const categoryFilter = within(filterDialog).getByRole("group", { name: "filter.categories" });
    const articleListCard = document.querySelector(".wiki-article-list-card");

    expect(articleListCard).not.toBeNull();
    expect(categoryFilter).toBeInTheDocument();
    expect(within(articleListCard as HTMLElement).queryByRole("group", {
      name: "filter.categories",
    })).not.toBeInTheDocument();
  });

  it("asks before closing a dirty category editor", async () => {
    categoryEditorState.isDirty = true;
    categoryEditorMock.mockImplementation(() => ({
      categoryName: "",
      categoryDrafts: [],
      isCreating: false,
      isSavingDrafts: false,
      canSaveDrafts: false,
      deletingCategoryId: null,
      setCategoryName: vi.fn(),
      createCategory: vi.fn(),
      saveCategoryDrafts: vi.fn(),
      resetCategoryDrafts: resetCategoryDraftsMock,
      setCategoryDraftName: vi.fn(),
      moveCategory: vi.fn(),
      deleteCategory: vi.fn(),
      isDirty: categoryEditorState.isDirty,
    }));
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderWikiPage();

    fireEvent.click(await screen.findByRole("button", { name: "editor.editCategories" }));
    fireEvent.click(await screen.findByRole("button", { name: "editor.closeNoSave" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(resetCategoryDraftsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "editor.closeNoSave" }));

    await waitFor(() => expect(resetCategoryDraftsMock).toHaveBeenCalledTimes(1));
  });

  it("creates categories beside Save without a separate empty name field", async () => {
    renderWikiPage();

    fireEvent.click(await screen.findByRole("button", { name: "editor.editCategories" }));
    const create = await screen.findByRole("button", { name: "categoryEditor.create" });
    const save = screen.getByRole("button", { name: "articleEditor.save" });

    expect(create.parentElement).toBe(save.parentElement);
    expect(screen.queryByLabelText("aria.categoryName")).not.toBeInTheDocument();
  });

  it("offers article creation when the resource is globally empty", async () => {
    paramsMock.slug = undefined;
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue(null);
    serviceMocks.fetchWikiArticles.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });

    renderWikiPage();

    const emptyState = (await screen.findByText("empty")).closest(".empty-state");
    expect(emptyState).not.toBeNull();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "articleEditor.create",
    }));

    expect(startCreateArticleMock).toHaveBeenCalledOnce();
  });

  it("offers filter reset instead of article creation when filters hide all results", async () => {
    const user = userEvent.setup();
    paramsMock.slug = undefined;
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue(null);
    serviceMocks.fetchWikiArticles.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });

    renderWikiPage();

    await user.click(await screen.findByRole("button", { name: "common:filter.toggle" }));
    const filterDialog = await screen.findByRole("dialog", { name: /common:filter\.toggle/ });
    await user.click(within(filterDialog).getByRole("switch", { name: "filter.showPinned" }));
    const emptyState = (await screen.findByText("empty")).closest(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "articleEditor.create",
    })).not.toBeInTheDocument();
    await user.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "action.resetFilters",
    }));

    const toggle = await screen.findByRole("button", { name: "common:filter.toggle" });
    await user.click(toggle);
    expect(within(await screen.findByRole("dialog", {
      name: /common:filter\.toggle/,
    })).getByRole("switch", { name: "filter.showPinned" })).toBeInTheDocument();
  });

  it("does not expose article creation when the user only has edit permission", async () => {
    permissionState.allowed = new Set(["wiki.articles.edit"]);
    paramsMock.slug = undefined;
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue(null);
    serviceMocks.fetchWikiArticles.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });

    renderWikiPage();

    const emptyState = (await screen.findByText("empty")).closest(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "articleEditor.create",
    })).not.toBeInTheDocument();
  });

  it("keeps article-list header actions at 44px without enlarging their icons", async () => {
    renderWikiPage();

    const createButton = await screen.findByRole("button", {
      name: "articleEditor.create",
    });
    const categoriesButton = screen.getByRole("button", {
      name: "editor.editCategories",
    });

    for (const button of [createButton, categoriesButton]) {
      expect(button).toHaveClass("wiki-header-action");
      expect(button.querySelector("svg")).toHaveAttribute("width", "16");
      expect(button.querySelector("svg")).toHaveAttribute("height", "16");
    }
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/WikiPage.css"), "utf8");
    expect(css).toMatch(/\.wiki-header-action\s*\{[\s\S]*?inline-size:\s*2\.75rem[\s\S]*?block-size:\s*2\.75rem/);
  });

  it("keeps the shell title as the only h1 and exposes the article title as h2", async () => {
    render(
      <>
        <h1>Wiki</h1>
        <WikiPage />
      </>,
      { wrapper: createWrapper() },
    );

    fireEvent.click(await screen.findByText("Kept Article"));
    const articleHeadings = await screen.findAllByRole("heading", {
      level: 2,
      name: "Deleted Article",
    });
    expect(articleHeadings.some((heading) =>
      heading.classList.contains("wiki-article-reader-title"),
    )).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Wiki" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "editor.editWiki" }));
    expect(await screen.findByRole("heading", {
      level: 2,
      name: "articleEditor.title",
    })).toHaveClass("wiki-article-editor-title");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    const titleField = screen.getByRole("textbox", { name: "aria.articleTitle" });
    expect(titleField.closest(".wiki-editor-fields")).not.toBeNull();
  });

  it("locks the article delete action while deletion is pending", async () => {
    articleEditorState.isDeleting = true;
    renderWikiPage();

    fireEvent.click(await screen.findByText("Kept Article"));
    fireEvent.click(await screen.findByRole("button", { name: "editor.editWiki" }));

    expect(await screen.findByRole("button", {
      name: "common:action.delete",
    })).toBeDisabled();
  });

  it("keeps the narrow wiki editor comfortably tall and long headings wrap-safe", () => {
    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/WikiPage.css"), "utf8");
    const titleRule = css.match(
      /\.wiki-article-reader-title,\s*\.wiki-article-editor-title\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const narrowEditorRule = css.match(
      /@media \(max-width: 767px\)[\s\S]*?\.wiki-article-editor-card \.infini-tiptap-surface\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(titleRule).toContain("overflow-wrap: anywhere");
    expect(titleRule).toContain("min-width: 0");
    expect(narrowEditorRule).toContain("min-height: clamp(");
    expect(narrowEditorRule).not.toContain("overflow");
  });

  it("wires wiki sort through the toolbar without a shared clear action", async () => {
    renderWikiPage();

    const filterToggle = await screen.findByRole("button", { name: "common:filter.toggle" });
    fireEvent.click(filterToggle);
    const filterDialog = await screen.findByRole("dialog", { name: "common:filter.toggle" });
    const sort = within(filterDialog).getByRole("radiogroup", { name: "filter.sort" });
    expect(within(sort).getByRole("radio", { name: "filter.sort.curated" })).toHaveAttribute("aria-checked", "true");
    expect(filterToggle.closest(".content-filter-toolbar")).toHaveClass("wiki-page-toolbar");

    fireEvent.click(within(sort).getByRole("radio", { name: "filter.sort.updated_asc" }));

    await waitFor(() =>
      expect(serviceMocks.fetchWikiArticles).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "updated_asc" }),
      ),
    );
    expect(screen.queryByText("filter.summary.sort")).not.toBeInTheDocument();

    expect(within(sort).getByRole("radio", { name: "filter.sort.updated_asc" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "common:filter.clearAll" })).not.toBeInTheDocument();
  });

  it("uses the shared toolbar with a contained desktop workspace", async () => {
    renderWikiPage();

    await screen.findByRole("button", { name: "common:filter.toggle" });
    const pageLayout = document.querySelector<HTMLElement>(".page-layout");
    const toolbar = document.querySelector<HTMLElement>(".page-layout__toolbar");
    const workspace = document.querySelector<HTMLElement>(".page-layout__workspace");
    const filters = document.querySelector<HTMLElement>(".wiki-page-toolbar");

    expect(pageLayout).toHaveAttribute("data-workspace-mode", "contained");
    expect(toolbar).toContainElement(filters);
    expect(workspace).not.toContainElement(filters);
  });

  it("uses a semantic breadcrumb and page-scoped reading layout", async () => {
    renderWikiPage();

    const breadcrumb = await screen.findByRole("navigation", { name: "aria.breadcrumb" });
    expect(within(breadcrumb).getByText("title")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Guides")).toBeInTheDocument();

    const css = readFileSync(resolve(process.cwd(), "apps/portal/components/pages/WikiPage.css"), "utf8");
    const editorCss = readFileSync(resolve(process.cwd(), "apps/portal/components/shared/tiptap-editor.css"), "utf8");
    expect(css).toMatch(
      /\.wiki-article-reader-content\s*\{[\s\S]*?width:\s*min\(100%,\s*72ch\)[\s\S]*?max-width:\s*100%[\s\S]*?margin-inline:\s*auto/,
    );
    /* 阅读卡按正文高度收起；只有列表和编辑面板占满工作区、各自承接长内容滚动。 */
    const readerCardRule = css.match(/\.wiki-article-reader-card\s*\{([^}]*)\}/)?.[1] ?? "";
    const readerScrollRule = css.match(/\.wiki-article-reader-scroll\s*\{([^}]*)\}/)?.[1] ?? "";
    const mobileStyles = css.slice(css.lastIndexOf("@media (max-width: 767px)"));

    expect(readerCardRule).toContain("flex: 0 0 auto");
    expect(readerCardRule).toContain("block-size: auto");
    expect(readerCardRule).toContain("max-inline-size: 60rem");
    expect(readerScrollRule).toContain("flex: 0 0 auto");
    expect(readerScrollRule).toContain("overflow: visible");
    expect(css).toMatch(
      /\.wiki-article-list-card,\s*\.wiki-article-editor-card,\s*\.wiki-category-editor-card\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?block-size:\s*100%/,
    );
    expect(mobileStyles).toMatch(
      /\.wiki-article-list-card,\s*\.wiki-article-editor-card\s*\{[^}]*min-block-size:\s*12\.5rem/,
    );
    expect(mobileStyles).not.toMatch(
      /\.wiki-article-reader-card\s*\{[^}]*min-block-size:\s*12\.5rem/,
    );
    expect(css).toMatch(/\.wiki-page-grid\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)[\s\S]*?flex:\s*1 1 auto/);
    expect(css).not.toContain("100dvh");
    /* 宽屏读卡仍裁切圆角，正文本身不再变成第二个滚动容器。 */
    expect(css).toMatch(/\.wiki-article-reader-card\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(css).not.toMatch(/\.wiki-article-reader-card \.infini-tiptap-toc/);
    expect(editorCss).toMatch(
      /\.infini-tiptap-toc\s*\{[\s\S]*?position:\s*sticky[\s\S]*?width:\s*200px/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.infini-tiptap-layout\s*\{[\s\S]*?flex-direction:\s*column[\s\S]*?\.infini-tiptap-toc\s*\{[\s\S]*?position:\s*static[\s\S]*?width:\s*100%/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.wiki-article-item \+ \.wiki-article-item\s*\{[\s\S]*?border-block-start-color:\s*var\(--border-subtle\)/,
    );
  });

  it("uses Wiki and category context instead of repeating the article title in the mobile sheet", async () => {
    mediaState.isDesktop = false;
    renderWikiPage();

    await screen.findByText("Deleted Article", { selector: ".wiki-article-reader-title" });
    const drawerTitle = document.querySelector("[data-slot=sheet-title]");
    expect(drawerTitle).not.toBeNull();
    expect(drawerTitle).toHaveTextContent("Wiki / Guides");
    expect(drawerTitle).not.toHaveTextContent("Deleted Article");
  });

  it("keeps a dirty article editor open when mobile Back is cancelled and closes after confirmation", async () => {
    mediaState.isDesktop = false;
    articleEditorState.isDirty = true;
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderWikiPage();

    fireEvent.click(await screen.findByRole("button", { name: "editor.editWiki" }));
    await screen.findByText("articleEditor.title", { selector: ".wiki-article-editor-title" });
    const back = screen.getByRole("button", { name: "backToList" });
    expect(back).toHaveClass("wiki-back-button");
    expect(back.querySelector("svg")).not.toBeNull();

    fireEvent.click(back);
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "backToList" })).toBeInTheDocument();
    expect(exitArticleEditorMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "backToList" }));
    await waitFor(() => expect(exitArticleEditorMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "backToList" })).not.toBeInTheDocument(),
    );
  });

  it("keeps a dirty category editor open when the sheet close action is cancelled and closes after confirmation", async () => {
    mediaState.isDesktop = false;
    paramsMock.slug = undefined;
    routeSearchMock.selection = "none";
    categoryEditorState.isDirty = true;
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderWikiPage();

    fireEvent.click(await screen.findByRole("button", { name: "editor.editCategories" }));
    expect(await screen.findByRole("button", { name: "editor.closeNoSave" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=sheet-title]")).toHaveTextContent(
      "categoryEditor.title",
    );

    const close = document.querySelector("[data-slot=sheet-close]") as HTMLButtonElement | null;
    expect(close).not.toBeNull();
    fireEvent.click(close as HTMLButtonElement);

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "editor.closeNoSave" })).toBeInTheDocument();
    expect(resetCategoryDraftsMock).not.toHaveBeenCalled();

    fireEvent.click(close as HTMLButtonElement);
    await waitFor(() => expect(resetCategoryDraftsMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "editor.closeNoSave" })).not.toBeInTheDocument(),
    );
  });
});
