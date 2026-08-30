import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import type { Announcement } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../core/error-handler.js";
import type { HttpEnv } from "../core/http-env.js";
import { createRequestContextMiddleware } from "../core/request-context-middleware.js";
import { createAnnouncementRoutes, type AnnouncementRouteDependencies } from "./announcements/announcements-routes.js";
import { createGalleryRoutes, type GalleryRouteDependencies } from "./gallery/gallery-routes.js";
import { createWikiRoutes, type WikiRouteDependencies } from "./wiki/wiki-routes.js";

const NOW = "2026-08-09T12:00:00.000Z";
const BODY_JSON = JSON.stringify({ type: "doc", content: [] });
const announcement: Announcement = {
  id: "announcement-1",
  title: "Notice",
  body_json: BODY_JSON,
  category: "announcement",
  pinned: false,
  view_count: 0,
  excerpt: "",
  status: "draft",
  publish_at: null,
  expires_at: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  created_at: NOW,
  updated_at: NOW,
  preview_media_id: null,
  author: { id: "user-1", display_name: "Admin", avatar_media_id: null },
  attachments: [],
};

describe("content HTTP routes", () => {
  it("uses one required aggregate ETag for announcement reads, edits, archives, and deletes", async () => {
    const list = vi.fn();
    const get = vi.fn().mockResolvedValue(announcement);
    const update = vi.fn().mockResolvedValue(announcement);
    const archive = vi.fn().mockResolvedValue({ ok: true });
    const remove = vi.fn().mockResolvedValue({ ok: true });
    const service = {
      list,
      get,
      update,
      archive,
      delete: remove,
    } as unknown as AnnouncementRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/announcements", createAnnouncementRoutes({
      service,
      publicOrigin: "https://guild.example",
      getMediaPolicy: () => ({ imageMaxBytes: 1024, imageQuota: 10, attachmentMaxBytes: 1024, attachmentQuota: 5 }),
    }));

    expect((await app.request("/api/announcements?page=10001")).status).toBe(400);
    expect(list).not.toHaveBeenCalled();

    const detail = await app.request("/api/announcements/announcement-1");
    const contentEtag = detail.headers.get("ETag");
    const revisionEtag = `"announcement-announcement-1-${NOW}"`;
    expect(contentEtag).toBe(revisionEtag);

    expect((await app.request("/api/announcements/announcement-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    })).status).toBe(400);

    const response = await app.request("/api/announcements/announcement-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": revisionEtag },
      body: JSON.stringify({ title: "Updated" }),
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      request,
      "announcement-1",
      { title: "Updated" },
      "https://guild.example",
      10,
      5,
      revisionEtag,
    );

    expect((await app.request("/api/announcements/announcement-1", {
      method: "DELETE",
    })).status).toBe(400);
    expect((await app.request("/api/announcements/announcement-1/permanent", {
      method: "DELETE",
    })).status).toBe(400);
    expect((await app.request("/api/announcements/announcement-1", {
      method: "DELETE",
      headers: { "If-Match": revisionEtag },
    })).status).toBe(200);
    expect((await app.request("/api/announcements/announcement-1/permanent", {
      method: "DELETE",
      headers: { "If-Match": revisionEtag },
    })).status).toBe(200);
    expect(archive).toHaveBeenCalledWith(request, "announcement-1", revisionEtag);
    expect(remove).toHaveBeenCalledWith(request, "announcement-1", revisionEtag);
  });

  it("accepts exactly one staged announcement attachment", async () => {
    const uploadPendingAttachment = vi.fn().mockResolvedValue({
      expires_at: "2026-08-10T12:00:00.000Z",
      attachment: {
        media_id: "123456789012345678901",
        name: "strategy.guildpack",
        content_type: "application/octet-stream",
        byte_size: 8,
      },
    });
    const service = { uploadPendingAttachment } as unknown as AnnouncementRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/announcements", createAnnouncementRoutes({
      service,
      publicOrigin: "https://guild.example",
      getMediaPolicy: () => ({ imageMaxBytes: 1024, imageQuota: 10, attachmentMaxBytes: 1024, attachmentQuota: 5 }),
    }));
    const form = new FormData();
    form.append("file", new File(["strategy"], "strategy.guildpack", { type: "application/x-guild-pack" }));

    const response = await app.request("/api/announcements/attachments", { method: "POST", body: form });

    expect(response.status).toBe(201);
    expect(uploadPendingAttachment).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ originalName: "strategy.guildpack", contentType: "application/x-guild-pack" }),
      1024,
      5,
    );
  });

  it("aligns gallery multipart metadata and preserves explicit instant filters", async () => {
    const uploadImages = vi.fn().mockResolvedValue({ data: [galleryItem] });
    const list = vi.fn().mockResolvedValue({ data: [galleryItem], next_cursor: null });
    const service = { uploadImages, list } as unknown as GalleryRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/gallery", createGalleryRoutes({
      service,
      getImagePolicy: () => ({ maxBytes: 2048, quota: 20 }),
    }));

    await app.request("/api/gallery?date_from=2026-08-01T04%3A00%3A00.000Z&date_to=2026-08-10T03%3A59%3A59.999Z");
    expect(list).toHaveBeenCalledWith(request, expect.objectContaining({
      dateFrom: "2026-08-01T04:00:00.000Z",
      dateTo: "2026-08-10T03:59:59.999Z",
    }));

    for (const query of [
      "date_from=2026-08-01",
      "date_from=2026-08-10T00%3A00%3A00.000Z&date_to=2026-08-09T00%3A00%3A00.000Z",
      "unexpected=true",
    ]) {
      expect((await app.request(`/api/gallery?${query}`)).status).toBe(400);
    }

    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    form.append("titles", " Caption ");
    const response = await app.request("/api/gallery/images", { method: "POST", body: form });
    expect(response.status).toBe(201);
    expect(uploadImages).toHaveBeenCalledWith(
      request,
      expect.any(Array),
      [{ title: "Caption", description: null }],
      2048,
      20,
    );
  });

  it("requires an exact Gallery item ETag for deletion", async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true });
    const app = appWithContext();
    app.route("/api/gallery", createGalleryRoutes({
      service: { delete: remove } as unknown as GalleryRouteDependencies["service"],
      getImagePolicy: () => ({ maxBytes: 2048, quota: 20 }),
    }));

    expect((await app.request("/api/gallery/gallery-1", { method: "DELETE" })).status).toBe(400);
    const etag = '"gallery-gallery-1-revision-1"';
    expect((await app.request("/api/gallery/gallery-1", {
      method: "DELETE",
      headers: { "If-Match": etag },
    })).status).toBe(200);
    expect(remove).toHaveBeenCalledWith(request, "gallery-1", etag);
  });

  it("requires an exact Gallery item ETag when updating title and description", async () => {
    const update = vi.fn().mockResolvedValue({
      ...galleryItem,
      title: "Renamed",
      description: "Updated description",
      revision_token: "gallery-revision-2",
    });
    const app = appWithContext();
    app.route("/api/gallery", createGalleryRoutes({
      service: { update } as unknown as GalleryRouteDependencies["service"],
      getImagePolicy: () => ({ maxBytes: 2048, quota: 20 }),
    }));
    const body = JSON.stringify({ title: " Renamed ", description: " Updated description " });

    expect((await app.request("/api/gallery/gallery-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    })).status).toBe(400);

    const etag = '"gallery-gallery-1-gallery-revision-1"';
    const response = await app.request("/api/gallery/gallery-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": etag },
      body,
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(request, "gallery-1", {
      title: "Renamed",
      description: "Updated description",
    }, etag);
  });

  it("normalizes repeated wiki categories and keeps revision routes ahead of slug", async () => {
    const listCategories = vi.fn().mockResolvedValue(wikiCategoryCatalog);
    const batchUpdateCategories = vi.fn().mockResolvedValue(wikiCategoryCatalog);
    const deleteCategory = vi.fn().mockResolvedValue({ ok: true });
    const listArticles = vi.fn().mockResolvedValue({ data: [wikiArticle], total: 1, page: 1, limit: 20, total_pages: 1 });
    const listRevisions = vi.fn().mockResolvedValue([wikiRevision]);
    const getArticleBySlug = vi.fn();
    const updateArticle = vi.fn().mockResolvedValue(wikiArticle);
    const archiveArticle = vi.fn().mockResolvedValue({ ok: true });
    const deleteArticle = vi.fn().mockResolvedValue({ ok: true });
    const restoreRevision = vi.fn().mockResolvedValue(wikiArticle);
    getArticleBySlug.mockResolvedValue(wikiArticle);
    const service = {
      listCategories,
      batchUpdateCategories,
      deleteCategory,
      listArticles,
      listRevisions,
      getArticleBySlug,
      updateArticle,
      archiveArticle,
      deleteArticle,
      restoreRevision,
    } as unknown as WikiRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/wiki", createWikiRoutes({
      service,
      publicOrigin: "https://guild.example",
      getImagePolicy: () => ({ maxBytes: 1024, quota: 10 }),
    }));

    await app.request("/api/wiki/articles?category_id=a,b&category_id=b&category_id=c");
    expect(listArticles).toHaveBeenCalledWith(request, expect.objectContaining({ categoryIds: ["a", "b", "c"] }));
    listArticles.mockClear();
    expect((await app.request("/api/wiki/articles?page=10001")).status).toBe(400);
    expect(listArticles).not.toHaveBeenCalled();

    const catalog = await app.request("/api/wiki/categories");
    expect(await catalog.json()).toEqual(wikiCategoryCatalog);
    const batch = await app.request("/api/wiki/categories/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision_token: "category-state-1",
        updates: [{ id: "category-1", name: "Renamed" }],
      }),
    });
    expect(batch.status).toBe(200);
    expect(batchUpdateCategories).toHaveBeenCalledWith(request, {
      expected_revision_token: "category-state-1",
      updates: [{ id: "category-1", name: "Renamed" }],
    });

    expect((await app.request("/api/wiki/categories/category-1", {
      method: "DELETE",
    })).status).toBe(400);
    const deleted = await app.request("/api/wiki/categories/category-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision_token: "category-state-1" }),
    });
    expect(deleted.status).toBe(200);
    expect(deleteCategory).toHaveBeenCalledWith(request, "category-1", "category-state-1");

    const revisions = await app.request("/api/wiki/articles/article-1/revisions?before_revision=51&limit=20");
    expect(revisions.status).toBe(200);
    expect(listRevisions).toHaveBeenCalledWith(request, "article-1", { beforeRevision: 51, limit: 20 });
    expect(getArticleBySlug).not.toHaveBeenCalled();

    const detail = await app.request("/api/wiki/articles/guide");
    const etag = detail.headers.get("ETag");
    expect(etag).toBe(`"wiki-article-1-${NOW}"`);
    await app.request("/api/wiki/articles/article-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": etag! },
      body: JSON.stringify({ title: "Updated guide" }),
    });
    expect(updateArticle).toHaveBeenCalledWith(
      request,
      "article-1",
      expect.objectContaining({ title: "Updated guide" }),
      "https://guild.example",
      etag,
    );
    expect((await app.request("/api/wiki/articles/article-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Missing revision" }),
    })).status).toBe(400);
    expect((await app.request("/api/wiki/articles/article-1", { method: "DELETE" })).status).toBe(400);
    expect((await app.request("/api/wiki/articles/article-1/permanent", { method: "DELETE" })).status).toBe(400);
    expect((await app.request("/api/wiki/articles/article-1", {
      method: "DELETE",
      headers: { "If-Match": etag! },
    })).status).toBe(200);
    expect((await app.request("/api/wiki/articles/article-1/permanent", {
      method: "DELETE",
      headers: { "If-Match": etag! },
    })).status).toBe(200);
    expect(archiveArticle).toHaveBeenCalledWith(request, "article-1", etag);
    expect(deleteArticle).toHaveBeenCalledWith(request, "article-1", etag);

    const restore = await app.request("/api/wiki/articles/article-1/revisions/1/restore", {
      method: "POST",
      headers: { "If-Match": etag! },
    });
    expect(restore.status).toBe(200);
    expect(restoreRevision).toHaveBeenCalledWith(request, "article-1", 1, etag);
    expect((await app.request("/api/wiki/articles/article-1/revisions/1/restore", { method: "POST" })).status).toBe(400);
  });

  it("stages announcement images without exposing an existing-record image mutation", async () => {
    const uploadPendingImages = vi.fn().mockResolvedValue({
      expires_at: "2026-08-10T12:00:00.000Z",
      media_ids: ["123456789012345678901"],
    });
    const uploadImages = vi.fn().mockResolvedValue({ media_ids: ["123456789012345678901"] });
    const service = { uploadPendingImages, uploadImages } as unknown as AnnouncementRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/announcements", createAnnouncementRoutes({
      service,
      publicOrigin: "https://guild.example",
      getMediaPolicy: () => ({ imageMaxBytes: 1024, imageQuota: 10, attachmentMaxBytes: 1024, attachmentQuota: 5 }),
    }));
    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));

    expect((await app.request("/api/announcements/images", { method: "POST", body: form })).status).toBe(201);
    expect(uploadPendingImages).toHaveBeenCalledOnce();

    const existingForm = new FormData();
    existingForm.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    existingForm.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    expect((await app.request("/api/announcements/announcement-1/images", {
      method: "POST",
      body: existingForm,
    })).status).toBe(404);
    expect(uploadImages).not.toHaveBeenCalled();
  });
});

const request: RequestContext = createRequestContext({
  requestId: "request-content",
  authorization: createAuthorizationContext({
    userId: "user-1",
    sessionId: "session-1",
    roleId: "admin",
    roleLevel: 1,
    permissions: [
      PERMISSION_ID.ANNOUNCEMENTS_CREATE,
      PERMISSION_ID.GALLERY_UPLOAD,
      PERMISSION_ID.WIKI_ARTICLES_EDIT,
    ],
  }),
  now: NOW,
});

function appWithContext(): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => request));
  app.onError(createHttpErrorHandler());
  return app;
}

const galleryItem = {
  id: "gallery-1",
  type: "image" as const,
  media_id: "Abcdefghijklmnopqrstu",
  url: null,
  title: "Caption",
  description: null,
  uploaded_by: "user-1",
  uploaded_by_name: "admin",
  like_count: 0,
  liked_by_viewer: false,
  created_at: NOW,
  revision_token: "gallery-revision-1",
};

const wikiArticle = {
  id: "article-1",
  title: "Guide",
  slug: "guide",
  category_id: "a",
  body_json: BODY_JSON,
  sort_order: 0,
  pinned: false,
  view_count: 0,
  excerpt: "",
  preview_media_id: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  updated_by_display_name: null,
  created_at: NOW,
  updated_at: NOW,
};

const wikiRevision = {
  id: "revision-1",
  article_id: "article-1",
  revision: 1,
  title: "Guide",
  edited_by: "user-1",
  edited_by_display_name: "admin",
  restored_from: null,
  created_at: NOW,
};

const wikiCategoryCatalog = {
  categories: [{
    id: "category-1",
    name: "Guides",
    slug: "guides",
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
  }],
  revision_token: "category-state-1",
};
