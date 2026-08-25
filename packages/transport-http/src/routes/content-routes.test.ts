import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import type { Announcement } from "@guild/shared";
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
  pinned: false,
  status: "draft",
  publish_at: null,
  expires_at: null,
  archived_at: null,
  created_by: "user-1",
  updated_by: null,
  created_at: NOW,
  updated_at: NOW,
  author: { id: "user-1", display_name: "Admin", avatar_media_id: null },
  attachments: [],
};

describe("content HTTP routes", () => {
  it("uses a content ETag for detail caching while updates retain the revision ETag", async () => {
    const get = vi.fn().mockResolvedValue(announcement);
    const update = vi.fn().mockResolvedValue(announcement);
    const service = {
      get,
      update,
    } as unknown as AnnouncementRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/announcements", createAnnouncementRoutes({
      service,
      publicOrigin: "https://guild.example",
      getMediaPolicy: () => ({ imageMaxBytes: 1024, imageQuota: 10, attachmentMaxBytes: 1024, attachmentQuota: 5 }),
    }));

    const detail = await app.request("/api/announcements/announcement-1");
    const contentEtag = detail.headers.get("ETag");
    const revisionEtag = `"announcement-announcement-1-${NOW}"`;
    expect(contentEtag).not.toBe(revisionEtag);

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
  });

  it("accepts exactly one staged announcement attachment", async () => {
    const uploadPendingAttachment = vi.fn().mockResolvedValue({
      expires_at: "2026-08-10T12:00:00.000Z",
      attachment: {
        media_id: "123456789012345678901",
        name: "guide.pdf",
        content_type: "application/pdf",
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
    form.append("file", new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" }));

    const response = await app.request("/api/announcements/attachments", { method: "POST", body: form });

    expect(response.status).toBe(201);
    expect(uploadPendingAttachment).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ originalName: "guide.pdf", contentType: "application/pdf" }),
      1024,
      5,
    );
  });

  it("aligns gallery multipart captions and preserves UTC date filters", async () => {
    const uploadImages = vi.fn().mockResolvedValue({ data: [galleryItem] });
    const list = vi.fn().mockResolvedValue({ data: [galleryItem], next_cursor: null });
    const service = { uploadImages, list } as unknown as GalleryRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/gallery", createGalleryRoutes({
      service,
      getImagePolicy: () => ({ maxBytes: 2048, quota: 20 }),
    }));

    await app.request("/api/gallery?date_from=2026-08-01&date_to=2026-08-09");
    expect(list).toHaveBeenCalledWith(request, expect.objectContaining({
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-09T23:59:59.999Z",
    }));

    const form = new FormData();
    form.append("full", new File(["full"], "full.webp", { type: "image/webp" }));
    form.append("view", new File(["view"], "view.webp", { type: "image/webp" }));
    form.append("captions", " Caption ");
    const response = await app.request("/api/gallery/images", { method: "POST", body: form });
    expect(response.status).toBe(201);
    expect(uploadImages).toHaveBeenCalledWith(
      request,
      expect.any(Array),
      ["Caption"],
      2048,
      20,
    );
  });

  it("normalizes repeated wiki categories and keeps revision routes ahead of slug", async () => {
    const listArticles = vi.fn().mockResolvedValue({ data: [wikiArticle], total: 1, page: 1, limit: 20, total_pages: 1 });
    const listRevisions = vi.fn().mockResolvedValue([wikiRevision]);
    const getArticleBySlug = vi.fn();
    const updateArticle = vi.fn().mockResolvedValue(wikiArticle);
    getArticleBySlug.mockResolvedValue(wikiArticle);
    const service = { listArticles, listRevisions, getArticleBySlug, updateArticle } as unknown as WikiRouteDependencies["service"];
    const app = appWithContext();
    app.route("/api/wiki", createWikiRoutes({
      service,
      publicOrigin: "https://guild.example",
      getImagePolicy: () => ({ maxBytes: 1024, quota: 10 }),
    }));

    await app.request("/api/wiki/articles?category_id=a,b&category_id=b&category_id=c");
    expect(listArticles).toHaveBeenCalledWith(request, expect.objectContaining({ categoryIds: ["a", "b", "c"] }));

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
  });
});

const request: RequestContext = createRequestContext({
  requestId: "request-content",
  authorization: createAuthorizationContext({
    userId: "user-1",
    sessionId: "session-1",
    roleId: "admin",
    roleLevel: 1,
    permissions: [],
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
  caption: "Caption",
  uploaded_by: "user-1",
  uploaded_by_name: "admin",
  created_at: NOW,
};

const wikiArticle = {
  id: "article-1",
  title: "Guide",
  slug: "guide",
  category_id: "a",
  body_json: BODY_JSON,
  sort_order: 0,
  pinned: false,
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
