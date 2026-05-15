// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikiPage } from "./WikiPage";

const navigateMock = vi.hoisted(() => vi.fn());
const paramsMock = vi.hoisted(() => ({ slug: "deleted-article" as string | undefined }));
const wikiEditorMock = vi.hoisted(() => vi.fn());
const categoryEditorMock = vi.hoisted(() => vi.fn());
const serviceMocks = vi.hoisted(() => ({
  fetchWikiArticleBySlug: vi.fn(),
  fetchWikiArticles: vi.fn(),
  fetchWikiCategories: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsMock,
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
    canManage: () => true,
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
    paramsMock.slug = "deleted-article";
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
      resetCategoryDrafts: vi.fn(),
      setCategoryDraftName: vi.fn(),
      setCategoryDraftParentId: vi.fn(),
      reorderCategories: vi.fn(),
      deleteCategory: vi.fn(),
      isDirty: false,
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
      startCreateArticle: vi.fn(),
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
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/wiki",
        replace: true,
        viewTransition: false,
      }),
    );
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/wiki/$slug",
        params: { slug: "kept-article" },
      }),
    );
  });
});
