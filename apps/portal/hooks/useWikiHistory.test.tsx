import { wikiArticleEtag, type WikiArticle, type WikiRevision, type WikiRevisionListItem } from "@guild/shared";
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

function revision(overrides: Partial<WikiRevision> = {}): WikiRevision {
  return {
    id: "revision-2",
    article_id: "article-1",
    revision: 2,
    title: "Guide",
    edited_by: "user-1",
    edited_by_display_name: "User One",
    restored_from: null,
    created_at: "2026-08-09T00:00:00.000Z",
    slug: "guide",
    category_id: "category-1",
    body_json: JSON.stringify({ type: "doc", content: [] }),
    sort_order: 0,
    pinned: false,
    archived_at: null,
    deleted_at: null,
    media_ids: [],
    ...overrides,
  };
}

function revisionListItem(overrides: Partial<WikiRevisionListItem> = {}): WikiRevisionListItem {
  const value = revision(overrides);
  return {
    id: value.id,
    article_id: value.article_id,
    revision: value.revision,
    title: value.title,
    edited_by: value.edited_by,
    edited_by_display_name: value.edited_by_display_name,
    restored_from: value.restored_from,
    created_at: value.created_at,
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

  it("uses semantic body equality for same-content revision restores", async () => {
    const current = article({
      body_json: '{"content":[{"type":"paragraph","content":[{"text":"Same","type":"text"}]}],"type":"doc"}',
    });
    const selected = revision({
      body_json: '{"type":"doc","content":[{"content":[{"type":"text","text":"Same"}],"type":"paragraph"}]}',
    });
    serviceMocks.fetchRevisions.mockResolvedValue([revisionListItem()]);
    serviceMocks.fetchRevision.mockResolvedValue(selected);

    const { result } = renderHook(
      () => useWikiHistory({ article: current, opened: true, onClose: vi.fn() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.diff).not.toBeNull());
    expect(result.current.isIdenticalToCurrent).toBe(true);
    expect(result.current.hasChanges).toBe(false);
  });

  it("exposes and retries the revision-list query error", async () => {
    serviceMocks.fetchRevisions.mockRejectedValueOnce(new Error("history unavailable")).mockResolvedValue([]);
    const { result } = renderHook(
      () => useWikiHistory({ article: article(), opened: true, onClose: vi.fn() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.listError).toBe(true));
    await act(async () => { await result.current.retryList(); });
    await waitFor(() => expect(result.current.listError).toBe(false));
    expect(serviceMocks.fetchRevisions).toHaveBeenCalledTimes(2);
  });

  it("exposes and retries the selected revision query error", async () => {
    serviceMocks.fetchRevisions.mockResolvedValue([revisionListItem()]);
    serviceMocks.fetchRevision.mockRejectedValueOnce(new Error("revision unavailable")).mockResolvedValue(revision());
    const { result } = renderHook(
      () => useWikiHistory({ article: article(), opened: true, onClose: vi.fn() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.diffError).toBe(true));
    await act(async () => { await result.current.retryDiff(); });
    await waitFor(() => expect(result.current.diffError).toBe(false));
    expect(serviceMocks.fetchRevision).toHaveBeenCalledWith("article-1", 2);
    expect(serviceMocks.fetchRevision).toHaveBeenCalledTimes(2);
  });
});
