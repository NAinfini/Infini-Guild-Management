import type { WikiCategory, WikiCategoryCatalog } from "@guild/shared";
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
vi.mock("./useAppError", () => ({ useAppError: () => ({ showError }) }));
vi.mock("../utils/notifications", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function category(overrides: Partial<WikiCategory> & { id: string }): WikiCategory {
  return {
    name: overrides.id,
    slug: overrides.id,
    sort_order: 0,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

const CATEGORIES = [
  category({ id: "root", name: "Root", sort_order: 0 }),
  category({ id: "guides", name: "Guides", sort_order: 1 }),
  category({ id: "combat", name: "Combat", sort_order: 2 }),
];

function catalog(categories: WikiCategory[] = CATEGORIES, revision = "category-state-1"): WikiCategoryCatalog {
  return { categories, revision_token: revision };
}

function createHarness(initialCatalog: WikiCategoryCatalog | null = catalog(), initialOpen = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const rendered = renderHook(
    (props: { categoryCatalog: WikiCategoryCatalog | undefined; isOpen: boolean }) => useWikiCategoryEditor(props),
    { wrapper: Wrapper, initialProps: { categoryCatalog: initialCatalog ?? undefined, isOpen: initialOpen } },
  );
  return { ...rendered, queryClient };
}

describe("useWikiCategoryEditor", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    showError.mockReset();
    apiMocks.create.mockResolvedValue(category({ id: "new", name: "categoryEditor.defaultName", sort_order: 3 }));
    apiMocks.remove.mockResolvedValue(undefined);
  });

  it("keeps a dirty draft and its original collection token across a background refresh", async () => {
    const { result, rerender } = createHarness();
    act(() => result.current.setCategoryDraftName("guides", "Local guides"));
    act(() => result.current.moveCategory("combat", "root"));

    rerender({
      categoryCatalog: catalog([
        category({ id: "root", name: "Server root", sort_order: 0 }),
        category({ id: "guides", name: "Server guides", sort_order: 1 }),
        category({ id: "combat", name: "Combat", sort_order: 2 }),
      ], "category-state-2"),
      isOpen: true,
    });

    expect(result.current.categoryDrafts.map((draft) => draft.id)).toEqual(["combat", "root", "guides"]);
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Local guides");

    apiMocks.batchUpdate.mockResolvedValue(catalog(CATEGORIES, "category-state-3"));
    act(() => result.current.saveCategoryDrafts());
    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledWith("category-state-1", [
      { id: "combat", sort_order: 0 },
      { id: "root", sort_order: 1 },
      { id: "guides", name: "Local guides", sort_order: 2 },
    ]));
  });

  it("adopts the latest catalog only after the editor is closed or reset", async () => {
    const { result, rerender } = createHarness();
    act(() => result.current.setCategoryDraftName("guides", "Local guides"));
    const refreshed = catalog([
      ...CATEGORIES.slice(0, 1),
      category({ id: "guides", name: "Server guides", sort_order: 1 }),
      CATEGORIES[2]!,
    ], "category-state-2");

    rerender({ categoryCatalog: refreshed, isOpen: true });
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Local guides");

    rerender({ categoryCatalog: refreshed, isOpen: false });
    await waitFor(() => {
      expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Server guides");
    });
    act(() => result.current.setCategoryDraftName("guides", "Fresh draft"));
    apiMocks.batchUpdate.mockResolvedValue(refreshed);
    act(() => result.current.saveCategoryDrafts());
    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledWith(
      "category-state-2",
      [{ id: "guides", name: "Fresh draft" }],
    ));
  });

  it("sends one request carrying only rows that changed against the frozen catalog", async () => {
    apiMocks.batchUpdate.mockResolvedValue(catalog());
    const { result } = createHarness();

    act(() => result.current.setCategoryDraftName("guides", "Guides & Tips"));
    act(() => result.current.moveCategory("combat", "root"));
    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledWith("category-state-1", [
      { id: "combat", sort_order: 0 },
      { id: "root", sort_order: 1 },
      { id: "guides", name: "Guides & Tips", sort_order: 2 },
    ]));
  });

  it("writes the returned catalog into the cache and resets the saved draft", async () => {
    const saved = catalog([
      category({ id: "combat", name: "Combat", sort_order: 0 }),
      category({ id: "root", name: "Root", sort_order: 1 }),
      category({ id: "guides", name: "Guides & Tips", sort_order: 2 }),
    ], "category-state-2");
    apiMocks.batchUpdate.mockResolvedValue(saved);
    const { result, queryClient } = createHarness();

    act(() => result.current.setCategoryDraftName("guides", "Guides & Tips"));
    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(queryClient.getQueryData(queryKeys.wiki.categories())).toEqual(saved));
    expect(result.current.hasDraftChanges).toBe(false);
  });

  it("adds a newly created category to the visible draft immediately", async () => {
    const created = category({
      id: "new",
      name: "New Category",
      sort_order: 1,
    });
    apiMocks.create.mockResolvedValue(created);
    const { result } = createHarness(catalog([
      category({ id: "root", name: "Root", sort_order: 0 }),
    ]));

    act(() => result.current.createCategory());

    await waitFor(() => expect(result.current.categoryDrafts).toEqual([
      { id: "root", name: "Root", slug: "root", sort_order: 0 },
      { id: "new", name: "New Category", slug: "new", sort_order: 1 },
    ]));
    expect(result.current.hasDraftChanges).toBe(false);
  });

  it("keeps a newly created category while an in-flight catalog response catches up", async () => {
    const created = category({
      id: "new",
      name: "New Category",
      sort_order: 1,
    });
    apiMocks.create.mockResolvedValue(created);
    const { result, rerender } = createHarness(null);

    act(() => result.current.createCategory());
    await waitFor(() => expect(result.current.categoryDrafts.map((draft) => draft.id)).toEqual(["new"]));

    rerender({
      categoryCatalog: catalog([category({ id: "root", name: "Root", sort_order: 0 })]),
      isOpen: true,
    });

    await waitFor(() => expect(result.current.categoryDrafts.map((draft) => draft.id)).toEqual(["root", "new"]));
    expect(result.current.hasDraftChanges).toBe(false);

    const settledCatalog = catalog([
      category({ id: "root", name: "Root", sort_order: 0 }),
      created,
    ], "category-state-2");
    rerender({ categoryCatalog: settledCatalog, isOpen: true });
    await waitFor(() => expect(result.current.categoryDrafts.map((draft) => draft.id)).toEqual(["root", "new"]));

    apiMocks.batchUpdate.mockResolvedValue(settledCatalog);
    act(() => result.current.setCategoryDraftName("new", "Renamed category"));
    act(() => result.current.saveCategoryDrafts());
    await waitFor(() => expect(apiMocks.batchUpdate).toHaveBeenCalledWith("category-state-2", [
      { id: "new", name: "Renamed category" },
    ]));
  });

  it("does not call the API for a current no-op", async () => {
    const { result } = createHarness();
    act(() => result.current.saveCategoryDrafts());
    await waitFor(() => expect(result.current.isSavingDrafts).toBe(false));
    expect(apiMocks.batchUpdate).not.toHaveBeenCalled();
  });

  it("deletes with the catalog revision frozen by the current editor render", async () => {
    const { result } = createHarness();

    act(() => result.current.deleteCategory("guides"));

    await waitFor(() => expect(apiMocks.remove).toHaveBeenCalledWith("guides", "category-state-1"));
  });

  it("keeps a rejected stale draft intact while refreshing the query cache", async () => {
    apiMocks.batchUpdate.mockRejectedValue(new Error("Category tree changed"));
    const { result, queryClient } = createHarness();
    queryClient.setQueryData(queryKeys.wiki.categories(), catalog());
    act(() => result.current.setCategoryDraftName("guides", "Local guides"));
    act(() => result.current.saveCategoryDrafts());

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(result.current.categoryDrafts.find((draft) => draft.id === "guides")?.name).toBe("Local guides");
    expect(queryClient.getQueryData(queryKeys.wiki.categories())).toEqual(catalog());
  });
});
