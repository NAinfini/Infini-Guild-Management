// @vitest-environment jsdom
import type { WikiCategory } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/query-keys";
import { useWikiCategoryEditor } from "./useWikiCategoryEditor";

const apiMocks = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

const showError = vi.hoisted(() => vi.fn());

vi.mock("../services/WikiService", () => ({
  batchUpdateWikiCategories: apiMocks.batchUpdate,
  createWikiCategory: apiMocks.create,
  deleteWikiCategory: apiMocks.remove,
}));

vi.mock("./useAppError", () => ({
  useAppError: () => ({ showError }),
}));

vi.mock("../utils/notifications", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function category(overrides: Partial<WikiCategory> & { id: string }): WikiCategory {
  return {
    name: overrides.id,
    slug: overrides.id,
    sort_order: 0,
    parent_id: null,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

const CATEGORIES = [
  category({ id: "root", name: "Root", sort_order: 0 }),
  category({ id: "guides", name: "Guides", sort_order: 1 }),
  category({ id: "combat", name: "Combat", sort_order: 2, parent_id: "guides" }),
];

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const rendered = renderHook(
    (props: { categories: WikiCategory[] }) => useWikiCategoryEditor(props),
    { wrapper: Wrapper, initialProps: { categories: CATEGORIES } },
  );
  return { ...rendered, queryClient };
}

describe("useWikiCategoryEditor", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    showError.mockReset();
  });

  /* 这条盯的就是「N 次 PATCH」这个老写法：改两行只能发一个请求，中途失败不能留下半套。 */
  it("sends one request carrying only the rows that actually changed", async () => {
    apiMocks.batchUpdate.mockResolvedValue(CATEGORIES);
    const { result } = createHarness();

    act(() => result.current.setCategoryDraftName("guides", "Guides & Tips"));
    act(() => result.current.reorderCategories("combat", "root"));
    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledTimes(1));

    // 拖动后顺序是 combat / root / guides，三行的 sort_order 全变了；
    // guides 还多改了一个名字。
    expect(apiMocks.batchUpdate).toHaveBeenCalledWith([
      { id: "combat", sort_order: 0 },
      { id: "root", sort_order: 1 },
      { id: "guides", name: "Guides & Tips", sort_order: 2 },
    ]);
  });

  it("writes the returned catalog straight into the cache instead of refetching", async () => {
    const saved = [
      category({ id: "combat", name: "Combat", sort_order: 0 }),
      category({ id: "root", name: "Root", sort_order: 1 }),
      category({ id: "guides", name: "Guides & Tips", sort_order: 2 }),
    ];
    apiMocks.batchUpdate.mockResolvedValue(saved);
    const { result, queryClient } = createHarness();

    act(() => result.current.setCategoryDraftName("guides", "Guides & Tips"));
    await act(async () => { result.current.saveCategoryDrafts(); });

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.wiki.categories())).toEqual(saved);
    });
  });

  it("does not call the API when nothing changed", async () => {
    const { result } = createHarness();

    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(result.current.isSavingDrafts).toBe(false));
    expect(apiMocks.batchUpdate).not.toHaveBeenCalled();
  });

  /* 整批被拒时缓存不能被改动过的草稿污染：界面必须能回到库里的真实顺序。 */
  it("surfaces the error and leaves the cache untouched when the batch is rejected", async () => {
    apiMocks.batchUpdate.mockRejectedValue(new Error("Category nesting supports only one level"));
    const { result, queryClient } = createHarness();
    queryClient.setQueryData(queryKeys.wiki.categories(), CATEGORIES);

    act(() => result.current.setCategoryDraftParentId("guides", "root"));
    await act(async () => { result.current.saveCategoryDrafts(); });

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(queryClient.getQueryData(queryKeys.wiki.categories())).toEqual(CATEGORIES);
  });
});
