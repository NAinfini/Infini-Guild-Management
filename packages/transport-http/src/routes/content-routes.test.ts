import { createAuthorizationContext, createRequestContext, type RequestContext } from "@guild/kernel";
import type { Announcement } from "@guild/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createHttpErrorHandler } from "../core/error-handler.js";
import type { HttpEnv } from "../core/http-env.js";
import { createRequestContextMiddleware } from "../core/request-context-middleware.js";
import { createAnnouncementRoutes, type AnnouncementRouteDependencies } from "./announcements/announcements-routes.js";
import { createAuditRoutes } from "./audit/audit-routes.js";
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
};

describe("content HTTP routes", () => {
  it("maps audit filters and streams CSV without buffering the iterable", async () => {
    const list = vi.fn().mockResolvedValue({ data: [auditRow], total: 1, page: 2, limit: 10, total_pages: 1 });
    const exportRows = vi.fn(() => (async function* () { yield auditRow; })());
    const recordExport = vi.fn().mockResolvedValue(undefined);
    const app = appWithContext();
    app.route("/api/admin", createAuditRoutes({ service: { list, export: exportRows, recordExport } }));

    const response = await app.request("/api/admin/audit-log?page=2&limit=10&actor_id=user-1");
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(request, expect.objectContaining({
      page: 2,
      limit: 10,
      actorUserId: "user-1",
    }));

    const exported = await app.request(`/api/admin/audit-log/export?format=csv&start_at=${NOW}&end_at=${NOW}`);
    expect(exported.headers.get("Content-Disposition")).toContain("guild-audit-2026-08-09-to-2026-08-09.csv");
    const csv = await exported.text();
    expect(csv).toContain("id,entity_type,action,actor_id");
    expect(csv).toContain(`"'  =SUM(1,2)"`);
    expect(recordExport).toHaveBeenCalledOnce();
    expect(exportRows).toHaveBeenCalledOnce();
  });

  it("uses the announcement detail ETag unchanged for If-Match updates", async () => {
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
      getImagePolicy: () => ({ maxBytes: 1024, quota: 10 }),
    }));

    const detail = await app.request("/api/announcements/announcement-1");
    const etag = detail.headers.get("ETag");
    expect(etag).toBe(`"announcement-announcement-1-${NOW}"`);

    const response = await app.request("/api/announcements/announcement-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": etag! },
      body: JSON.stringify({ title: "Updated" }),
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      request,
      "announcement-1",
      { title: "Updated" },
      "https://guild.example",
      10,
      etag,
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
    permissions: ["admin.audit.view", "admin.audit.export"],
  }),
  now: NOW,
});

function appWithContext(): Hono<HttpEnv> {
  const app = new Hono<HttpEnv>();
  app.use("*", createRequestContextMiddleware(() => request));
  app.onError(createHttpErrorHandler());
  return app;
}

const auditRow = {
  id: "audit-1",
  entity_type: "announcement" as const,
  action: "update" as const,
  actor_id: "user-1",
  actor_username: "admin",
  entity_id: "announcement-1",
  diff_title: "  =SUM(1,2)",
  detail: { changed: true },
  created_at: NOW,
};

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
  updated_by_username: null,
  created_at: NOW,
  updated_at: NOW,
};

const wikiRevision = {
  id: "revision-1",
  article_id: "article-1",
  revision: 1,
  title: "Guide",
  edited_by: "user-1",
  edited_by_username: "admin",
  restored_from: null,
  created_at: NOW,
};
