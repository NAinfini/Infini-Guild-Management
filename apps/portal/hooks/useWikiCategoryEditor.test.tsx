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
    apiMocks.create.mockResolvedValue(undefined);
    apiMocks.remove.mockResolvedValue(undefined);
  });

  it("preserves dirty fields and order when categories refetch", () => {
    const { result, rerender } = createHarness();
    act(() => result.current.setCategoryDraftName("guides", "Local guides"));
    act(() => result.current.moveCategory("combat", { parentId: "", index: 0 }));

    rerender({
      categories: [
        category({ id: "root", name: "Server root", sort_order: 0 }),
        category({ id: "guides", name: "Guides", sort_order: 1 }),
        category({ id: "combat", name: "Combat", sort_order: 2, parent_id: "guides" }),
        category({ id: "new", name: "New", sort_order: 3 }),
      ],
    });

    expect(result.current.categoryDrafts.map((draft) => draft.id)).toEqual([
      "combat",
      "root",
      "guides",
      "new",
    ]);
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Local guides");
    expect(result.current.categoryDrafts.find((draft) => draft.id === "combat")?.parent_id).toBe("");
  });

  it("keeps existing drafts through create and delete refreshes", async () => {
    const { result, rerender } = createHarness();
    act(() => result.current.setCategoryDraftName("guides", "Unsaved guides"));

    act(() => result.current.createCategory());
    await waitFor(() => expect(apiMocks.create).toHaveBeenCalledOnce());
    rerender({ categories: [...CATEGORIES, category({ id: "new", name: "New", sort_order: 3 })] });
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Unsaved guides");

    act(() => result.current.deleteCategory("root"));
    await waitFor(() => expect(apiMocks.remove.mock.calls[0]?.[0]).toBe("root"));
    rerender({ categories: [CATEGORIES[1]!, CATEGORIES[2]!, category({ id: "new", name: "New", sort_order: 3 })] });
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Unsaved guides");
  });

  /* 这条盯的就是「N 次 PATCH」这个老写法：改两行只能发一个请求，中途失败不能留下半套。 */
  it("sends one request carrying only the rows that actually changed", async () => {
    apiMocks.batchUpdate.mockResolvedValue(CATEGORIES);
    const { result } = createHarness();

    act(() => result.current.setCategoryDraftName("guides", "Guides & Tips"));
    act(() => result.current.moveCategory("combat", { parentId: "", index: 0 }));
    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledTimes(1));

    // combat 从 guides 底下提到最前面：它自己换了爹也换了序号，另外两行被顶下去，
    // 序号跟着变；guides 还多改了一个名字。
    expect(apiMocks.batchUpdate).toHaveBeenCalledWith([
      { id: "combat", parent_id: null, sort_order: 0 },
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
    /* 界面这边已经挡掉了三层嵌套，剩下的拒绝理由都是前端预判不了的——
       比如同一时间别人把这一行删了。这条只管：批次被拒之后缓存必须还是库里那份。 */
    apiMocks.batchUpdate.mockRejectedValue(new Error("Category not found"));
    const { result, queryClient } = createHarness();
    queryClient.setQueryData(queryKeys.wiki.categories(), CATEGORIES);

    act(() => result.current.moveCategory("root", { parentId: "guides", index: 0 }));
    await act(async () => { result.current.saveCategoryDrafts(); });

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(queryClient.getQueryData(queryKeys.wiki.categories())).toEqual(CATEGORIES);
  });
});
