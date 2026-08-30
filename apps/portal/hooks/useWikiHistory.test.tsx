import { wikiArticleEtag, type WikiArticle } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWikiHistory } from "./useWikiHistory";

const serviceMocks = vi.hoisted(() => ({
  fetchRevision: vi.fn(),
  fetchRevisions: vi.fn(),
  restore: vi.fn(),
}));
const showError = vi.hoisted(() => vi.fn());

vi.mock("../services/WikiService", () => ({
  fetchWikiArticleRevision: serviceMocks.fetchRevision,
  fetchWikiArticleRevisions: serviceMocks.fetchRevisions,
  restoreWikiArticleRevision: serviceMocks.restore,
}));
vi.mock("./useAppError", () => ({ useAppError: () => ({ showError }) }));
vi.mock("../utils/notifications", () => ({ notifySuccess: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function article(overrides: Partial<WikiArticle> = {}): WikiArticle {
  return {
    id: "article-1",
    title: "Guide",
    slug: "guide",
    category_id: "category-1",
    body_json: JSON.stringify({ type: "doc", content: [] }),
    sort_order: 0,
    pinned: false,
    view_count: 0,
    excerpt: "",
    preview_media_id: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: null,
    updated_by_display_name: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useWikiHistory", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    showError.mockReset();
    serviceMocks.fetchRevisions.mockResolvedValue([]);
    serviceMocks.restore.mockResolvedValue(article());
  });

  it("keeps the article revision observed when history opened across background refetches", async () => {
    const openedArticle = article();
    const refreshedArticle = article({
      title: "Concurrent update",
      updated_at: "2026-08-09T00:00:01.000Z",
    });
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      (props: { article: WikiArticle; opened: boolean }) => useWikiHistory({ ...props, onClose }),
      { wrapper: createWrapper(), initialProps: { article: openedArticle, opened: true } },
    );

    await waitFor(() => expect(serviceMocks.fetchRevisions).toHaveBeenCalledWith(openedArticle.id));
    rerender({ article: refreshedArticle, opened: true });
    act(() => result.current.restore(1));

    await waitFor(() => expect(serviceMocks.restore).toHaveBeenCalledWith(
      openedArticle.id,
      1,
      wikiArticleEtag(openedArticle),
    ));
  });
});
