// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiPage } from "./WikiPage";

const navigateMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => ({ slug: "deleted-article" as string | undefined }));
const routeSearchMock = vi.hoisted(() => ({ selection: undefined as "none" | undefined }));
const confirmMock = vi.hoisted(() => vi.fn());
const resetCategoryDraftsMock = vi.hoisted(() => vi.fn());
const categoryEditorState = vi.hoisted(() => ({ isDirty: false }));
const wikiEditorMock = vi.hoisted(() => vi.fn());
const categoryEditorMock = vi.hoisted(() => vi.fn());
const startCreateArticleMock = vi.hoisted(() => vi.fn());
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

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => confirmMock,
}));

vi.mock("../feature/wiki/WikiCategoryEditorCard", () => ({
  WikiCategoryEditorCard: ({ onCloseEditor }: { onCloseEditor: () => void }) => (
    <button type="button" onClick={onCloseEditor}>
      editor.closeNoSave
    </button>
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
    t: (key: string) => key,
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
    return (
      <MantineProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MantineProvider>
    );
  };
}

function renderWikiPage() {
  render(<WikiPage />, { wrapper: createWrapper() });
}

describe("WikiPage", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    resetCategoryDraftsMock.mockReset();
    startCreateArticleMock.mockReset();
    permissionState.allowed = null;
    categoryEditorState.isDirty = false;
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
          updated_by_username: null,
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
      updated_by_username: null,
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
      setCategoryDraftParentId: vi.fn(),
      reorderCategories: vi.fn(),
      deleteCategory: vi.fn(),
      resetCategoryDrafts: resetCategoryDraftsMock,
      isDirty: categoryEditorState.isDirty,
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
      isCreatingArticle: false,
      isDirty: false,
      isSaving: false,
      isCreating: false,
      canCreateArticle: true,
      startCreateArticle: startCreateArticleMock,
      exitEditor: vi.fn(),
      createArticle: vi.fn(),
      saveSelectedArticle: vi.fn(),
      togglePinnedIntent: vi.fn(),
      toggleArchiveIntent: vi.fn(),
      uploadWikiArticleImage: vi.fn(),
      deleteArticle: vi.fn(),
    });
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
      updated_by_username: null,
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

    fireEvent.click(screen.getByRole("button", { name: "filter.showPinned" }));

    await screen.findByText("Pinned Article");
    expect(screen.queryByText("Page One")).not.toBeInTheDocument();
    expect(screen.queryByText("Page Two")).not.toBeInTheDocument();
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
      setCategoryDraftParentId: vi.fn(),
      reorderCategories: vi.fn(),
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

    fireEvent.click(await screen.findByRole("button", { name: "filter.showPinned" }));
    const emptyState = (await screen.findByText("empty")).closest(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).queryByRole("button", {
      name: "articleEditor.create",
    })).not.toBeInTheDocument();
    fireEvent.click(within(emptyState as HTMLElement).getByRole("button", {
      name: "action.resetFilters",
    }));

    expect(await screen.findByRole("button", { name: "filter.showPinned" })).toBeInTheDocument();
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
});
