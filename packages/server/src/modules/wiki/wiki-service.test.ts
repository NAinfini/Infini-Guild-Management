import { describe, expect, it, vi } from "vitest";
import { createAuthorizationContext, createRequestContext } from "@guild/kernel";
import { WikiService, type WikiArticleRecord, type WikiCategoryRecord, type WikiStore } from "./wiki-service";
import type { MediaService } from "../media/public.js";

function context(permissions: readonly string[]) {
  return createRequestContext({
    requestId: "request-1",
    authorization: createAuthorizationContext({
      userId: "user-1",
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
    getArticleById: vi.fn(),
    createArticle: vi.fn(),
    mutateArticle: vi.fn(),
    listRevisions: vi.fn(),
    getRevision: vi.fn(),
    recordAudit: vi.fn(),
    ...overrides,
  };
}

function service(value: WikiStore, media: Partial<MediaService> = {}) {
  return new WikiService(
    value,
    media as MediaService,
    { publish: vi.fn() },
    { defer: vi.fn() },
  );
}

const rootCategory: WikiCategoryRecord = {
  id: "category-root",
  name: "Root",
  slug: "root",
  sort_order: 0,
  parent_id: null,
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
  archived_at: null,
  deletedAt: null,
  created_by: "user-1",
  updated_by: null,
  updated_by_username: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  revisionToken: "article-revision-123456",
  currentRevision: 1,
  mediaIds: [],
};

describe("WikiService", () => {
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

  it("rejects a projected category tree deeper than one child level before writing", async () => {
    const child: WikiCategoryRecord = { ...rootCategory, id: "category-child", slug: "child", parent_id: rootCategory.id };
    const anotherRoot: WikiCategoryRecord = { ...rootCategory, id: "another-root", slug: "another-root" };
    const updateCategories = vi.fn();
    const wiki = store({
      listCategories: vi.fn().mockResolvedValue({ records: [rootCategory, child, anotherRoot], stateToken: "state-1" }),
      updateCategories,
    });

    await expect(service(wiki).updateCategory(
      context(["wiki.categories.manage"]),
      rootCategory.id,
      { parent_id: "another-root" },
    )).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updateCategories).not.toHaveBeenCalled();
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
    const mediaId = "123456789012345678901";
    const created = await service(store({ createArticle })).createArticle(
      context(["wiki.articles.create"]),
      {
        title: " 指南 ",
        category_id: rootCategory.id,
        body_json: JSON.stringify({
          type: "doc",
          content: [{ type: "image", attrs: { src: `https://guild.example/api/media/${mediaId}/view` } }],
        }),
        sort_order: 0,
        pinned: true,
      },
      "https://guild.example/wiki",
    );

    expect(created.title).toBe("指南");
    const mutation = createArticle.mock.calls[0]![0];
    expect(mutation.record.body_json).not.toContain("https://guild.example");
    expect(mutation.mediaIds).toEqual([mediaId]);
    expect(mutation.initialRevision.revision).toBe(1);
    expect(mutation.audit.requestId).toBe("request-1");
  });

  it("uses revision-token CAS even when If-Match is absent", async () => {
    const mutateArticle = vi.fn().mockResolvedValue(false);
    const wiki = store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle });

    await expect(service(wiki).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { title: "Changed" },
      "https://guild.example",
    )).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mutateArticle.mock.calls[0]![0].expectedRevisionToken).toBe(article.revisionToken);
    expect(mutateArticle.mock.calls[0]![0].revision.revision).toBe(2);
  });

  it("requires archive permission when PATCH changes archived state", async () => {
    const mutateArticle = vi.fn();
    const wiki = store({ getArticleById: vi.fn().mockResolvedValue(article), mutateArticle });

    await expect(service(wiki).updateArticle(
      context(["wiki.articles.edit"]),
      article.id,
      { archived_at: "2026-08-09T00:00:00.000Z" },
      "https://guild.example",
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
      edited_by_username: "owner",
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
      context(["wiki.articles.edit", "wiki.articles.archive"]), article.id, 1,
    )).rejects.toMatchObject({ code: "FORBIDDEN" });

    await service(wiki).restoreRevision(
      context(["wiki.articles.edit", "wiki.articles.archive", "wiki.articles.delete"]), article.id, 1,
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
