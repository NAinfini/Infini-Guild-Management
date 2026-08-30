import { wikiArticleEtag, type WikiArticle, type WikiCategory } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWikiArticleEditor } from "./useWikiArticleEditor";

const serviceMocks = vi.hoisted(() => ({
  archiveWikiArticle: vi.fn(),
  createWikiArticle: vi.fn(),
  deleteWikiArticle: vi.fn(),
  updateWikiArticle: vi.fn(),
  uploadWikiArticleImages: vi.fn(),
}));

vi.mock("../services/WikiService", () => serviceMocks);
vi.mock("./useAppError", () => ({
  useAppError: () => ({ showError: vi.fn() }),
}));
vi.mock("../utils/notifications", () => ({ notifySuccess: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const category: WikiCategory = {
  id: "category-1",
  name: "Guides",
  slug: "guides",
  sort_order: 0,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

function article(overrides: Partial<WikiArticle> = {}): WikiArticle {
  return {
    id: "article-1",
    title: "Original guide",
    slug: "original-guide",
    category_id: category.id,
    body_json: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original body"}]}]}',
    excerpt: "Original body",
    sort_order: 0,
    pinned: false,
    view_count: 0,
    preview_media_id: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: null,
    updated_by_display_name: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useWikiArticleEditor", () => {
  beforeEach(() => {
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
  });

  it("keeps the local draft and original ETag across a background refresh", async () => {
    const original = article();
    const remote = article({ title: "Remote guide", updated_at: "2026-08-02T00:00:00.000Z" });
    const saved = article({ title: "Local guide", updated_at: "2026-08-03T00:00:00.000Z" });
    serviceMocks.updateWikiArticle.mockResolvedValue(saved);
    const { result, rerender } = renderHook(
      ({ selectedArticle }) => useWikiArticleEditor({
        canCreate: true,
        canEdit: true,
        canArchive: true,
        canDelete: true,
        categories: [category],
        selectedArticle,
        onArticleCreated: vi.fn(),
      }),
      { initialProps: { selectedArticle: original }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.articleTitle).toBe(original.title));
    act(() => {
      result.current.startEditArticle();
      result.current.setArticleTitle("Local guide");
    });
    rerender({ selectedArticle: remote });

    await waitFor(() => expect(result.current.editorArticle?.title).toBe(original.title));
    expect(result.current.articleTitle).toBe("Local guide");
    act(() => result.current.saveSelectedArticle());

    await waitFor(() => expect(serviceMocks.updateWikiArticle).toHaveBeenCalledWith(
      original.id,
      expect.objectContaining({ title: "Local guide" }),
      wikiArticleEtag(original),
    ));
    await waitFor(() => expect(result.current.editorArticle?.title).toBe(saved.title));
  });

  it("deletes with the editor-open ETag instead of a refreshed article snapshot", async () => {
    const original = article();
    const remote = article({ title: "Remote guide", updated_at: "2026-08-02T00:00:00.000Z" });
    serviceMocks.deleteWikiArticle.mockResolvedValue({ ok: true });
    const { result, rerender } = renderHook(
      ({ selectedArticle }) => useWikiArticleEditor({
        canCreate: true,
        canEdit: true,
        canArchive: true,
        canDelete: true,
        categories: [category],
        selectedArticle,
        onArticleCreated: vi.fn(),
      }),
      { initialProps: { selectedArticle: original }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.articleTitle).toBe(original.title));
    act(() => result.current.startEditArticle());
    rerender({ selectedArticle: remote });
    act(() => result.current.deleteArticle());

    await waitFor(() => expect(serviceMocks.deleteWikiArticle).toHaveBeenCalledWith(
      original.id,
      wikiArticleEtag(original),
    ));
  });

  it("keeps archive-only and delete-only actions on their dedicated APIs", async () => {
    const selectedArticle = article();
    serviceMocks.archiveWikiArticle.mockResolvedValue({ ok: true });
    serviceMocks.deleteWikiArticle.mockResolvedValue({ ok: true });
    const onArticleCreated = vi.fn();
    const archiveOnly = renderHook(() => useWikiArticleEditor({
      canCreate: false,
      canEdit: false,
      canArchive: true,
      canDelete: false,
      categories: [category],
      selectedArticle,
      onArticleCreated,
    }), { wrapper: createWrapper() });

    act(() => {
      archiveOnly.result.current.startEditArticle();
      archiveOnly.result.current.setArticleTitle("Unauthorized edit");
      archiveOnly.result.current.saveSelectedArticle();
      archiveOnly.result.current.deleteArticle();
      archiveOnly.result.current.archiveArticle();
    });

    await waitFor(() => expect(serviceMocks.archiveWikiArticle).toHaveBeenCalledWith(
      selectedArticle.id,
      wikiArticleEtag(selectedArticle),
    ));
    expect(serviceMocks.updateWikiArticle).not.toHaveBeenCalled();
    expect(serviceMocks.deleteWikiArticle).not.toHaveBeenCalled();

    archiveOnly.unmount();
    serviceMocks.archiveWikiArticle.mockClear();
    const deleteOnly = renderHook(() => useWikiArticleEditor({
      canCreate: false,
      canEdit: false,
      canArchive: false,
      canDelete: true,
      categories: [category],
      selectedArticle,
      onArticleCreated,
    }), { wrapper: createWrapper() });

    act(() => {
      deleteOnly.result.current.archiveArticle();
      deleteOnly.result.current.deleteArticle();
    });

    await waitFor(() => expect(serviceMocks.deleteWikiArticle).toHaveBeenCalledWith(
      selectedArticle.id,
      wikiArticleEtag(selectedArticle),
    ));
    expect(serviceMocks.archiveWikiArticle).not.toHaveBeenCalled();
  });

  it("does not navigate back into a create session after that session exits", async () => {
    let resolveCreate!: (value: WikiArticle) => void;
    serviceMocks.createWikiArticle.mockImplementation(() => new Promise<WikiArticle>((resolve) => {
      resolveCreate = resolve;
    }));
    const onArticleCreated = vi.fn();
    const { result } = renderHook(() => useWikiArticleEditor({
      canCreate: true,
      canEdit: false,
      canArchive: false,
      canDelete: false,
      categories: [category],
      selectedArticle: null,
      onArticleCreated,
    }), { wrapper: createWrapper() });

    act(() => {
      result.current.startCreateArticle();
    });
    act(() => {
      result.current.createArticle();
    });
    await waitFor(() => expect(serviceMocks.createWikiArticle).toHaveBeenCalledOnce());

    act(() => result.current.exitEditor());
    await act(async () => resolveCreate(article({ slug: "created-after-exit" })));
    await waitFor(() => expect(result.current.isCreating).toBe(false));

    expect(onArticleCreated).not.toHaveBeenCalled();
  });
});
