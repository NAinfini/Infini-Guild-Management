import { describe, expect, it, vi } from "vitest";
import {
  createAuthorizationContext,
  createRequestContext,
  type DeferredTasks,
  type NotificationPublisher,
} from "@guild/kernel";
import { wikiArticleEtag } from "@guild/shared";
import { WikiService, type WikiArticleRecord, type WikiCategoryRecord, type WikiStore } from "./wiki-service";
import type { MediaService } from "../media/public.js";

function context(permissions: readonly string[], userId = "user-1") {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId,
      sessionId: "session-1",
      roleId: "member",
      roleLevel: 100,
      permissions,
    }),
    now: "2026-08-09T00:00:00.000Z",
  });
}

function store(overrides: Partial<WikiStore> = {}): WikiStore {
  return {
    listCategories: vi.fn().mockResolvedValue({ records: [rootCategory], stateToken: "state-1" }),
    createCategory: vi.fn(),
    updateCategories: vi.fn(),
    deleteCategory: vi.fn(),
    listArticles: vi.fn(),
    getArticleBySlug: vi.fn(),
    incrementArticleView: vi.fn(),
    getArticleById: vi.fn(),
    createArticle: vi.fn(),
    mutateArticle: vi.fn(),
    listRevisions: vi.fn(),
    getRevision: vi.fn(),
    recordAudit: vi.fn(),
    ...overrides,
  };
}

function service(
  value: WikiStore,
  media: Partial<MediaService> = {},
  notifications: NotificationPublisher = { publish: vi.fn() },
  deferred: DeferredTasks = { defer: vi.fn() },
) {
  return new WikiService(
    value,
    media as MediaService,
    notifications,
    deferred,
  );
}

const rootCategory: WikiCategoryRecord = {
  id: "category-root",
  name: "Root",
  slug: "root",
  sort_order: 0,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "category-revision-123456",
};

const article: WikiArticleRecord = {
  id: "article-1",
  title: "Guide",
  slug: "guide",
  category_id: rootCategory.id,
  body_json: JSON.stringify({ type: "doc", content: [] }),
  sort_order: 0,
  pinned: false,
  view_count: 0,
  excerpt: "",
  preview_media_id: null,
  archived_at: null,
  deletedAt: null,
  created_by: "user-1",
  updated_by: null,
  updated_by_display_name: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "article-revision-123456",
  currentRevision: 1,
  mediaIds: [],
};

describe("WikiService", () => {
  it("exposes the category collection revision with the catalog", async () => {
    await expect(service(store()).listCategories()).resolves.toEqual({
      categories: [{
        id: rootCategory.id,
        name: rootCategory.name,
        slug: rootCategory.slug,
        sort_order: rootCategory.sort_order,
        created_at: rootCategory.created_at,
        updated_at: rootCategory.updated_at,
      }],
      revision_token: "state-1",
    });
  });

  it("uses the editor's category collection revision for batch and single-row updates", async () => {
    const updateCategories = vi.fn().mockResolvedValue(true);
    const wiki = store({ updateCategories });
    const permissions = ["wiki.categories.manage"];

    await service(wiki).batchUpdateCategories(context(permissions), {
      expected_revision_token: "state-1",
      updates: [{ id: rootCategory.id, name: "Renamed" }],
    });
    await service(wiki).updateCategory(context(permissions), rootCategory.id, {
      expected_revision_token: "state-1",
      name: "Renamed again",
    });

    expect(updateCategories.mock.calls.map(([input]) => input.expectedStateToken)).toEqual(["state-1", "state-1"]);
  });

  it("rejects a stale confirmation before deleting a category", async () => {
    const deleteCategory = vi.fn().mockResolvedValue(true);
    const wiki = store({
      listCategories: vi.fn().mockResolvedValue({ records: [rootCategory], stateToken: "state-2" }),
      deleteCategory,
    });

    await expect(service(wiki).deleteCategory(
      context(["wiki.categories.manage"]),
      rootCategory.id,
      "state-1",
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it("uses the confirmation-open category revision in the atomic delete", async () => {
    const deleteCategory = vi.fn().mockResolvedValue(true);

    await expect(service(store({ deleteCategory })).deleteCategory(
      context(["wiki.categories.manage"]),
      rootCategory.id,
      "state-1",
    )).resolves.toEqual({ ok: true });
    expect(deleteCategory).toHaveBeenCalledWith(expect.objectContaining({
      id: rootCategory.id,
      expectedStateToken: "state-1",
    }));
  });

  it("rejects a stale category draft before a no-op or audit can be written", async () => {
    const updateCategories = vi.fn();
    const wiki = store({
      listCategories: vi.fn().mockResolvedValue({ records: [rootCategory], stateToken: "state-2" }),
      updateCategories,
    });

    await expect(service(wiki).batchUpdateCategories(context(["wiki.categories.manage"]), {
      expected_revision_token: "state-1",
      updates: [{ id: rootCategory.id, name: rootCategory.name }],
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(updateCategories).not.toHaveBeenCalled();
  });

  it("does not advance category state or write an audit for a current no-op", async () => {
    const updateCategories = vi.fn();
    const wiki = store({ updateCategories });

    await expect(service(wiki).batchUpdateCategories(context(["wiki.categories.manage"]), {
      expected_revision_token: "state-1",
      updates: [{ id: rootCategory.id, name: rootCategory.name }],
    })).resolves.toMatchObject({ revision_token: "state-1" });
    expect(updateCategories).not.toHaveBeenCalled();
  });

  it("reports the category catalog ceiling without publishing a change", async () => {
    const createCategory = vi.fn().mockResolvedValue("limit_reached");
    const wiki = store({
      listCategories: vi.fn().mockResolvedValue({ records: [rootCategory], stateToken: "state-1" }),
      createCategory,
    });

    await expect(service(wiki).createCategory(
      context(["wiki.categories.manage"]),
      { name: "Overflow", sort_order: 1 },
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(createCategory).toHaveBeenCalledOnce();
  });

  it("records a visible wiki article view", async () => {
    const incrementArticleView = vi.fn().mockResolvedValue(4);

    await expect(service(store({ incrementArticleView })).recordArticleView(context([]), "guide"))
      .resolves.toEqual({ view_count: 4 });
    expect(incrementArticleView).toHaveBeenCalledWith("guide", { kind: "public" });
  });

  it("derives public, owned, and all wiki read scopes from server authorization", async () => {
    const listArticles = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 });
    const getArticleBySlug = vi.fn().mockResolvedValue(article);
    const incrementArticleView = vi.fn().mockResolvedValue(1);
    const wiki = service(store({ listArticles, getArticleBySlug, incrementArticleView }));
    const anonymous = createRequestContext({
      requestId: "request-public",
      authorization: createAuthorizationContext(null),
      now: "2026-08-09T00:00:00.000Z",
    });

    await wiki.listArticles(anonymous, { page: 1, limit: 20, categoryIds: [], sort: "curated" });
    await wiki.listArticles(context([]), { page: 1, limit: 20, categoryIds: [], sort: "curated" });
    await wiki.listArticles(context(["wiki.articles.create"], "author-a"), {
      page: 1,
      limit: 20,
      categoryIds: [],
      archived: true,
      sort: "curated",
    });
    await wiki.getArticleBySlug(context(["wiki.articles.create"], "author-a"), "guide");
    await wiki.recordArticleView(context(["wiki.articles.create"], "author-a"), "guide");
    await wiki.listArticles(context(["wiki.articles.archive"]), {
      page: 1,
      limit: 20,
      categoryIds: [],
      archived: true,
      sort: "curated",
    });

    expect(listArticles.mock.calls[0]![0].readScope).toEqual({ kind: "public" });
    expect(listArticles.mock.calls[1]![0].readScope).toEqual({ kind: "public" });
    expect(listArticles.mock.calls[2]![0].readScope).toEqual({ kind: "owned", ownerUserId: "author-a" });
    expect(getArticleBySlug).toHaveBeenCalledWith("guide", { kind: "owned", ownerUserId: "author-a" });
    expect(incrementArticleView).toHaveBeenCalledWith("guide", { kind: "owned", ownerUserId: "author-a" });
    expect(listArticles.mock.calls[3]![0].readScope).toEqual({ kind: "all" });
  });

  it("does not let public callers query archived articles", async () => {
    const listArticles = vi.fn();
    expect(() => service(store({ listArticles })).listArticles(context([]), {
      page: 1,
      limit: 20,
      categoryIds: [],
      archived: true,
      sort: "curated",
    })).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(listArticles).not.toHaveBeenCalled();
  });

  it("canonicalizes same-origin media and creates revision one in the atomic store mutation", async () => {
    const createArticle = vi.fn();
    const publish = vi.fn().mockResolvedValue(undefined);
    const mediaId = "123456789012345678901";
    const created = await service(
      store({ createArticle }),
      {},
      { publish },
      { defer: (task) => { void task(); } },
    ).createArticle(
      context(["wiki.articles.create"]),
      {
        title: " 指南 ",
        category_id: rootCategory.id,
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "image", attrs: { src: `https://guild.example/api/media/${mediaId}/view` } }, {
            type: "paragraph",
            content: [{
              type: "text",
              text: "Guide",
              marks: [{ type: "link", attrs: { href: "https://external.example/guide" } }],
            }],
          }],
        }),
        sort_order: 0,
        pinned: true,
      },
      "https://guild.example/wiki",
    );

    expect(created.title).toBe("指南");
    const mutation = createArticle.mock.calls[0]![0];
    expect(mutation.record.body_json).not.toContain("https://guild.example");
    expect(JSON.parse(mutation.record.body_json)).toMatchObject({
      content: [
        { attrs: { src: `/api/media/${mediaId}/view` } },
        {
          content: [{
            marks: [{
              attrs: {
                href: "https://external.example/guide",
                target: "_blank",
                rel: "noopener noreferrer",
                class: null,
              },
            }],
          }],
        },
      ],
    });
    expect(mutation.mediaIds).toEqual([mediaId]);
    expect(mutation.initialRevision.revision).toBe(1);
    expect(mutation.audit.requestId).toBe("request-1");
    expect(publish.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({
        type: "entity_changed",
        entity_type: "wiki",
        entity_id: created.id,
        hint: "article_created",
      }),
      { type: "inbox_changed" },
    ]);
  });

  it("rejects a missing or stale editor ETag before mutating an article", async () => {
    const mutateArticle = vi.fn();
    const wiki = store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle });

    await expect(service(wiki).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { title: "Changed" },
      "https://guild.example",
      undefined as unknown as string,
    )).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service(wiki).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { title: "Changed" },
      "https://guild.example",
      '"wiki-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mutateArticle).not.toHaveBeenCalled();
  });

  it("requires archive permission when PATCH changes archived state", async () => {
    const mutateArticle = vi.fn();
    const wiki = store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle });

    await expect(service(wiki).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { archived_at: "2026-08-09T00:00:00.000Z" },
      "https://guild.example",
      wikiArticleEtag(article),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mutateArticle).not.toHaveBeenCalled();
  });

  it("snapshots every mutable field for a metadata-only change", async () => {
    const mutateArticle = vi.fn().mockResolvedValue(true);
    await service(store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle })).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { slug: "new-guide", sort_order: 9, pinned: true },
      "https://guild.example",
      wikiArticleEtag(article),
    );

    expect(mutateArticle).toHaveBeenCalledOnce();
    expect(mutateArticle.mock.calls[0]![0].revision).toMatchObject({
      revision: 2,
      title: article.title,
      slug: "new-guide",
      category_id: article.category_id,
      body_json: article.body_json,
      sort_order: 9,
      pinned: true,
      archived_at: null,
      deleted_at: null,
      media_ids: [],
    });
  });

  it("turns permanent delete into an archived tombstone revision", async () => {
    const mutateArticle = vi.fn().mockResolvedValue(true);
    await service(store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle })).deleteArticle(
      context(["wiki.articles.delete"]),
      article.id,
      wikiArticleEtag(article),
    );

    expect(mutateArticle.mock.calls[0]![0]).toMatchObject({
      record: {
        deletedAt: "2026-08-09T00:00:00.000Z",
        archived_at: "2026-08-09T00:00:00.000Z",
        currentRevision: 2,
      },
      revision: {
        revision: 2,
        deleted_at: "2026-08-09T00:00:00.000Z",
        archived_at: "2026-08-09T00:00:00.000Z",
      },
    });
  });

  it("restores the full snapshot as N+1 and requires archive and delete permissions", async () => {
    const deleted = { ...article, archived_at: "2026-08-08T01:00:00.000Z", deletedAt: "2026-08-08T02:00:00.000Z", currentRevision: 3 };
    const snapshot = {
      id: "revision-1",
      article_id: article.id,
      revision: 1,
      title: "Original",
      slug: "original",
      category_id: "category-original",
      body_json: article.body_json,
      sort_order: 7,
      pinned: true,
      archived_at: null,
      deleted_at: null,
      media_ids: ["123456789012345678901"],
      edited_by: "user-1",
      edited_by_display_name: "owner",
      restored_from: null,
      created_at: article.created_at,
    } as const;
    const mutateArticle = vi.fn().mockResolvedValue(true);
    const wiki = store({
      listCategories: vi.fn().mockResolvedValue({
        records: [
          rootCategory,
          { ...rootCategory, id: "category-original", name: "Original", slug: "original-category" },
        ],
        stateToken: "state-1",
      }),
      getArticleById: vi.fn().mockResolvedValue(deleted),
      getRevision: vi.fn().mockResolvedValue(snapshot),
      mutateArticle,
    });

    await expect(service(wiki).restoreRevision(
      context(["wiki.articles.edit", "wiki.articles.archive"]), article.id, 1, wikiArticleEtag(deleted),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });

    await service(wiki).restoreRevision(
      context(["wiki.articles.edit", "wiki.articles.archive", "wiki.articles.delete"]), article.id, 1,
      wikiArticleEtag(deleted),
    );
    expect(mutateArticle.mock.calls[0]![0]).toMatchObject({
      record: {
        title: "Original",
        slug: "original",
        category_id: "category-original",
        sort_order: 7,
        pinned: true,
        archived_at: null,
        deletedAt: null,
        currentRevision: 4,
        mediaIds: ["123456789012345678901"],
      },
      revision: { revision: 4, restored_from: 1 },
    });
  });

  it("rejects stale archive and permanent-delete confirmations before mutation", async () => {
    const mutateArticle = vi.fn();
    const wiki = service(store({
      getArticleById: vi.fn().mockResolvedValue(article),
      mutateArticle,
    }));

    await expect(wiki.archiveArticle(
      context(["wiki.articles.archive"]),
      article.id,
      '"wiki-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(wiki.deleteArticle(
      context(["wiki.articles.delete"]),
      article.id,
      '"wiki-stale"',
    )).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mutateArticle).not.toHaveBeenCalled();
  });

  it("rejects a stale history restore before the atomic article mutation", async () => {
    const mutateArticle = vi.fn();
    const wiki = store({
      getArticleById: vi.fn().mockResolvedValue(article),
      getRevision: vi.fn().mockResolvedValue({
        id: "revision-1",
        article_id: article.id,
        revision: 1,
        title: "Earlier guide",
        slug: article.slug,
        category_id: article.category_id,
        body_json: article.body_json,
        sort_order: article.sort_order,
        pinned: article.pinned,
        archived_at: article.archived_at,
        deleted_at: article.deletedAt,
        media_ids: [],
        edited_by: "user-1",
        edited_by_display_name: null,
        restored_from: null,
        created_at: article.created_at,
      }),
      mutateArticle,
    });

    await expect(service(wiki).restoreRevision(
      context(["wiki.articles.edit"]),
      article.id,
      1,
      '"wiki-article-1-2026-08-09T00:00:00.000Z"',
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(mutateArticle).not.toHaveBeenCalled();
  });

  it("rejects test-only rich-text shorthand like every other caller", async () => {
    const createArticle = vi.fn();
    const input = {
      title: "Test",
      category_id: rootCategory.id,
      body_json: JSON.stringify({ content: "system test" }),
      sort_order: 0,
      pinned: false,
    };
    await expect(service(store({ createArticle })).createArticle(
      context(["wiki.articles.create"]), input, "https://guild.example",
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(createArticle).not.toHaveBeenCalled();
  });

  it("records a safe article-scoped audit after image upload", async () => {
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    const uploadImages = vi.fn().mockResolvedValue(["123456789012345678901"]);
    const result = await service(store({
      getArticleById: vi.fn().mockResolvedValue(article),
      recordAudit,
    }), { uploadImages }).uploadArticleImages(
      context(["wiki.articles.edit"]),
      article.id,
      [{ full: new Uint8Array([1]), view: new Uint8Array([2]) }],
      5,
      10_000,
    );

    expect(result.media_ids).toEqual(["123456789012345678901"]);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      subjectType: "wiki_article",
      subjectId: article.id,
      subjectLabel: article.title,
      action: "upload_images",
      payload: {
        schema_version: 2,
        changes: [],
        context: [{ field: "upload_count", value: { type: "number", value: 1 } }],
      },
    }));
  });
});
