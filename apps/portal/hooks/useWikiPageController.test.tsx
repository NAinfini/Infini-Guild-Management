import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { WikiArticle } from "@guild/shared";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useWikiPageController } from "./useWikiPageController";

const serviceMocks = vi.hoisted(() => ({
  fetchWikiArticleBySlug: vi.fn(),
  fetchWikiArticles: vi.fn(),
  fetchWikiCategories: vi.fn(),
  recordWikiArticleView: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routeMock = vi.hoisted(() => ({
  slug: undefined as string | undefined,
  pathname: "/wiki",
  entryKey: "wiki-list-entry",
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ slug: routeMock.slug }),
  useLocation: <T,>({ select }: { select: (location: {
    pathname: string;
    href: string;
    state: { __TSR_key: string; __TSR_index: number };
  }) => T }) =>
    select({
      pathname: routeMock.pathname,
      href: routeMock.pathname,
      state: { __TSR_key: routeMock.entryKey, __TSR_index: 0 },
    }),
}));

vi.mock("../services/WikiService", () => ({
  fetchWikiArticleBySlug: serviceMocks.fetchWikiArticleBySlug,
  fetchWikiArticles: serviceMocks.fetchWikiArticles,
  fetchWikiCategories: serviceMocks.fetchWikiCategories,
  recordWikiArticleView: serviceMocks.recordWikiArticleView,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@portal/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

vi.mock("./useDebouncedSearch", () => ({
  useDebouncedSearch: () => ({ search: "", setSearch: vi.fn(), debouncedSearch: "" }),
}));

vi.mock("./useBeforeUnloadPrompt", () => ({
  useBeforeUnloadPrompt: vi.fn(),
}));

vi.mock("./useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => ({
    canManage: () => true,
  }),
}));

vi.mock("./useWikiArticleEditor", () => ({
  useWikiArticleEditor: () => ({
    isCreatingArticle: false,
    isDirty: false,
    startCreateArticle: vi.fn(),
    exitEditor: vi.fn(),
  }),
}));

vi.mock("./useWikiCategoryEditor", () => ({
  useWikiCategoryEditor: () => ({
    isDirty: false,
    resetCategoryDrafts: vi.fn(),
    deleteCategory: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useWikiPageController", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    routeMock.slug = undefined;
    routeMock.pathname = "/wiki";
    routeMock.entryKey = "wiki-list-entry";
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
    }
    serviceMocks.fetchWikiCategories.mockResolvedValue({ categories: [], revision_token: "category-state-1" });
    serviceMocks.fetchWikiArticles.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      total_pages: 0,
    });
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue(null);
    serviceMocks.recordWikiArticleView.mockResolvedValue({ view_count: 1 });
  });

  it("requests and exposes at most three pinned wiki articles", async () => {
    const pinnedArticles: WikiArticle[] = Array.from({ length: 4 }, (_, index) => ({
      id: `wiki-pinned-${index + 1}`,
      title: `Pinned ${index + 1}`,
      slug: `pinned-${index + 1}`,
      category_id: "guides",
      body_json: "{}",
      sort_order: index,
      pinned: true,
      view_count: 0,
      excerpt: "",
      preview_media_id: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: "Guild Keeper",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
    serviceMocks.fetchWikiArticles.mockImplementation(async ({ pinned, page, limit }) => ({
      data: pinned ? pinnedArticles : [],
      total: pinned ? pinnedArticles.length : 0,
      page,
      limit,
      total_pages: pinned ? 2 : 0,
    }));

    const queryClient = createQueryClient();
    const { result } = renderHook(() => useWikiPageController(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(result.current.pinnedArticles).toHaveLength(3));
    expect(result.current.pinnedArticles.map(({ id }) => id)).toEqual([
      "wiki-pinned-1",
      "wiki-pinned-2",
      "wiki-pinned-3",
    ]);
    expect(serviceMocks.fetchWikiArticles).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 3,
      pinned: true,
    }));
  });

  it("does not load the hidden article catalog or pinned rows on a detail route", async () => {
    routeMock.pathname = "/wiki/detail-article";
    routeMock.slug = "detail-article";
    serviceMocks.fetchWikiArticleBySlug.mockResolvedValue({
      id: "wiki-detail",
      title: "Detail",
      slug: "detail-article",
      category_id: "guides",
      body_json: "{}",
      sort_order: 0,
      pinned: false,
      view_count: 0,
      excerpt: "",
      preview_media_id: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    renderHook(() => useWikiPageController(), { wrapper: createWrapper(createQueryClient()) });

    await waitFor(() => expect(serviceMocks.fetchWikiArticleBySlug).toHaveBeenCalledOnce());
    expect(serviceMocks.fetchWikiArticles).not.toHaveBeenCalled();
    expect(serviceMocks.fetchWikiCategories).toHaveBeenCalledOnce();
  });

  it("does not retry a failed article view request", async () => {
    routeMock.pathname = "/wiki/cached-wiki-article";
    routeMock.slug = "cached-wiki-article";
    routeMock.entryKey = "wiki-read-entry";
    serviceMocks.recordWikiArticleView.mockRejectedValue(new Error("network interrupted"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      renderHook(() => useWikiPageController(), { wrapper: createWrapper(createQueryClient()) });

      await waitFor(() => expect(serviceMocks.recordWikiArticleView).toHaveBeenCalledTimes(1));
      await new Promise<void>((resolve) => setTimeout(resolve, 1_300));

      expect(serviceMocks.recordWikiArticleView).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("counts each cached article route entry exactly once", async () => {
    const detail = {
      id: "wiki-cached",
      title: "Cached wiki article",
      slug: "cached-wiki-article",
      category_id: "guides",
      body_json: "{}",
      sort_order: 0,
      pinned: false,
      view_count: 3,
      excerpt: "",
      preview_media_id: null,
      archived_at: null,
      created_by: "user-1",
      updated_by: null,
      updated_by_display_name: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.wiki.article(detail.slug), detail);
    const { result, rerender } = renderHook(() => useWikiPageController(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.handleSelectArticle(detail.slug);
    });
    expect(serviceMocks.recordWikiArticleView).not.toHaveBeenCalled();

    routeMock.pathname = `/wiki/${detail.slug}`;
    routeMock.slug = detail.slug;
    routeMock.entryKey = "wiki-detail-entry-1";
    rerender();

    await waitFor(() => expect(serviceMocks.recordWikiArticleView).toHaveBeenCalledTimes(1));
    expect(serviceMocks.recordWikiArticleView.mock.calls[0]?.[0]).toBe(detail.slug);

    routeMock.pathname = "/wiki";
    routeMock.entryKey = "wiki-list-entry-2";
    rerender();
    expect(serviceMocks.recordWikiArticleView).toHaveBeenCalledTimes(1);

    routeMock.slug = undefined;
    rerender();

    routeMock.pathname = `/wiki/${detail.slug}`;
    routeMock.slug = detail.slug;
    routeMock.entryKey = "wiki-detail-entry-2";
    rerender();

    await waitFor(() => expect(serviceMocks.recordWikiArticleView).toHaveBeenCalledTimes(2));
    expect(serviceMocks.recordWikiArticleView.mock.calls.map(([slug]) => slug)).toEqual([
      detail.slug,
      detail.slug,
    ]);
  });
});
