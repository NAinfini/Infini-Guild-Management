import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeCacheStore = new Map<string, Response>();
const fakeCache = {
  match: async (req: Request) => fakeCacheStore.get(req.url) ?? null,
  put: async (req: Request, res: Response) => {
    fakeCacheStore.set(req.url, res.clone());
  },
  delete: async (req: Request) => fakeCacheStore.delete(req.url),
};

vi.stubGlobal("caches", {
  open: async () => fakeCache,
  default: fakeCache,
});

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getRequestUser: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  requirePermission: mocks.requirePermission,
  getRequestUser: mocks.getRequestUser,
}));

vi.mock("../services/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../services/push", () => ({
  publishAnnouncementPublished: vi.fn(),
  publishEntityChanged: vi.fn(),
}));

vi.mock("../services/AnnouncementService", () => ({
  AnnouncementService: vi.fn(() => ({
    archive: vi.fn(),
  })),
}));

vi.mock("../services/WikiService", () => ({
  WikiService: vi.fn(() => ({
    archiveArticle: vi.fn(),
  })),
}));

const galleryDeleteItem = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, data: { ok: true } }));
const guildWarServiceMethods = vi.hoisted(() => ({
  getActive: vi.fn().mockResolvedValue({ ok: true, data: { data: null } }),
  listHistory: vi.fn().mockResolvedValue({ ok: true, data: { data: [], total: 0, page: 1, limit: 20, total_pages: 0 } }),
  batchHistory: vi.fn().mockResolvedValue({ ok: true, data: { data: [] } }),
  getHistoryDetail: vi.fn().mockResolvedValue({ ok: true, data: { data: null } }),
  getAnalytics: vi.fn().mockResolvedValue({ ok: true, data: { data: [] } }),
}));
const searchServiceMethods = vi.hoisted(() => ({
  search: vi.fn().mockResolvedValue({ ok: true, data: { data: [{ id: "result-1", title: "Result", subtitle: "Search", type: "wiki", to: "/wiki" }] } }),
}));

vi.mock("../services/GalleryService", () => ({
  GalleryService: vi.fn(function GalleryServiceMock(this: { deleteItem: typeof galleryDeleteItem }) {
    this.deleteItem = galleryDeleteItem;
  }),
}));

vi.mock("../services/GuildWarService", () => ({
  GuildWarService: vi.fn(function GuildWarServiceMock(this: typeof guildWarServiceMethods) {
    Object.assign(this, guildWarServiceMethods);
  }),
}));

vi.mock("../services/SearchService", () => ({
  SearchService: vi.fn(function SearchServiceMock(this: typeof searchServiceMethods) {
    Object.assign(this, searchServiceMethods);
  }),
}));

const siteConfigServiceMethods = vi.hoisted(() => ({
  getPublicConfig: vi.fn().mockResolvedValue({ ok: true, data: { site_name: "Guild", site_logo_url: "/logo.webp" } }),
  getAdminConfig: vi.fn().mockResolvedValue({ ok: true, data: { site: {}, onboarding: {} } }),
  updateAdminConfig: vi.fn().mockResolvedValue({ ok: true, data: { site: {}, onboarding: {} } }),
  uploadSiteLogo: vi.fn().mockResolvedValue({ ok: true, data: { site: {}, onboarding: {} } }),
  updateOnboardingConfig: vi.fn().mockResolvedValue({ ok: true, data: { site: {}, onboarding: {} } }),
  getMemberOnboarding: vi.fn().mockResolvedValue({ ok: true, data: { config: {}, state: {}, is_complete: false } }),
  updateMemberProgress: vi.fn().mockResolvedValue({ ok: true, data: { config: {}, state: {}, is_complete: false } }),
  acknowledgeOnboarding: vi.fn().mockResolvedValue({ ok: true, data: { config: {}, state: {}, is_complete: true } }),
}));

vi.mock("../services/SiteConfigService", () => ({
  SiteConfigService: vi.fn(function SiteConfigServiceMock(this: typeof siteConfigServiceMethods) {
    Object.assign(this, siteConfigServiceMethods);
  }),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

beforeEach(() => {
  fakeCacheStore.clear();
  mocks.requirePermission.mockReset();
  mocks.getRequestUser.mockReset();
  galleryDeleteItem.mockClear();
  for (const method of Object.values(guildWarServiceMethods)) {
    method.mockClear();
  }
  for (const method of Object.values(searchServiceMethods)) {
    method.mockClear();
  }
  for (const method of Object.values(siteConfigServiceMethods)) {
    method.mockClear();
  }
});

describe("announcement and wiki permission mapping", () => {
  it("uses announcements.archive for announcement archive route", async () => {
    const { announcementsRoutes } = await import("./announcements");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await announcementsRoutes.request("/announcement-1", { method: "DELETE" });

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "announcements.archive");
  });

  it("uses wiki.articles.archive for wiki article archive route", async () => {
    const { wikiRoutes } = await import("./wiki");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await wikiRoutes.request("/articles/article-1", { method: "DELETE" });

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "wiki.articles.archive");
  });

  it("uses wiki.articles.edit for wiki revision list and restore routes", async () => {
    const { wikiRoutes } = await import("./wiki");

    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));
    const listResult = await wikiRoutes.request("/articles/article-1/revisions", { method: "GET" });
    expect(listResult.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(expect.anything(), "wiki.articles.edit");

    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));
    const restoreResult = await wikiRoutes.request("/articles/article-1/revisions/2/restore", { method: "POST" });
    expect(restoreResult.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(expect.anything(), "wiki.articles.edit");
  });

});

describe("gallery permission mapping", () => {
  it("uses session auth and passes gallery.delete capability for gallery item delete", async () => {
    const { galleryRoutes } = await import("./gallery");
    mocks.getRequestUser.mockResolvedValueOnce({
      id: "u-1",
      role: "member",
      permissions: new Set(["gallery.delete"]),
    });
    const result = await galleryRoutes.request("/item-1", { method: "DELETE" }, { DB: {}, MEDIA: {} });

    expect(result.status).toBe(200);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(galleryDeleteItem).toHaveBeenCalledWith("u-1", true, "item-1");
  });

});

describe("guild-war permission mapping", () => {
  it("requires guildwar.teams.edit for team save route", async () => {
    const { guildWarRoutes } = await import("./guild-war");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await guildWarRoutes.request("/save-teams", { method: "POST" });

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "guildwar.teams.edit");
  });

  it("requires guildwar.history.edit for history member stat updates", async () => {
    const { guildWarRoutes } = await import("./guild-war");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const result = await guildWarRoutes.request("/history/war-1/member-stats/user-1", { method: "PATCH" });

    expect(result.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "guildwar.history.edit");
  });

  const anonymousGuildWarReadRoutes = [
    ["GET /active", "/active", { method: "GET" }],
    ["GET /history", "/history", { method: "GET" }],
    [
      "POST /history/batch",
      "/history/batch",
      { method: "POST", body: JSON.stringify({ ids: ["war-1"] }), headers: { "Content-Type": "application/json" } },
    ],
    ["GET /history/:id", "/history/war-1", { method: "GET" }],
    ["GET /analytics", "/analytics?war_ids=war-1&user_ids=user-1", { method: "GET" }],
  ] as const;

  it.each(anonymousGuildWarReadRoutes)("allows anonymous guild-war read access for %s", async (_label, path, init) => {
    const { guildWarRoutes } = await import("./guild-war");
    mocks.getRequestUser.mockResolvedValueOnce(null);

    const result = await guildWarRoutes.request(path, init, { DB: {}, MEDIA: {} });

    expect(result.status).toBe(200);
  });
});

describe("search route visibility", () => {
  it("allows anonymous search access", async () => {
    const { searchRoutes } = await import("./search");
    mocks.getRequestUser.mockResolvedValueOnce(null);

    const result = await searchRoutes.request("/?q=ab", { method: "GET" }, { DB: {} });

    expect(result.status).toBe(200);
    expect(searchServiceMethods.search).toHaveBeenCalledWith({ query: "ab", limit: undefined });
  });

  it("delegates query parsing to SearchService for authenticated requests", async () => {
    const { searchRoutes } = await import("./search");
    mocks.getRequestUser.mockResolvedValueOnce({ id: "u-1", role: "member", permissions: new Set() });

    const result = await searchRoutes.request("/?q=%20ab%20&limit=100", { method: "GET" }, { DB: {} });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(searchServiceMethods.search).toHaveBeenCalledWith({ query: " ab ", limit: "100" });
    expect(body).toEqual({ data: [{ id: "result-1", title: "Result", subtitle: "Search", type: "wiki", to: "/wiki" }] });
  });
});

describe("site config and onboarding permission mapping", () => {
  it("allows public site config without a session", async () => {
    const { siteConfigRoutes } = await import("./site-config");

    const result = await siteConfigRoutes.request("/", { method: "GET" }, { DB: {} });

    expect(result.status).toBe(200);
    expect(mocks.getRequestUser).not.toHaveBeenCalled();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(siteConfigServiceMethods.getPublicConfig).toHaveBeenCalled();
  });

  it("returns public site config from the mounted app route", async () => {
    const { app } = await import("../index");

    const result = await app.request("/api/site-config", { method: "GET" }, {
      DB: {},
      SIGNING_SECRET: "test-secret",
      SITE_NAME: "Test Guild",
      SITE_LOGO_URL: "/test-logo.webp",
    });
    const body = await result.json() as { site_name: string; site_logo_url: string };

    expect(result.status).toBe(200);
    expect(body.site_name).toBe("Guild");
    expect(body.site_logo_url).toBe("/logo.webp");
    expect(siteConfigServiceMethods.getPublicConfig).toHaveBeenCalled();
    expect(mocks.getRequestUser).not.toHaveBeenCalled();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("uses standard service error status mapping for mounted public site config", async () => {
    const { app } = await import("../index");
    siteConfigServiceMethods.getPublicConfig.mockResolvedValueOnce({
      ok: false,
      code: "NOT_FOUND",
      message: "Missing site config",
    });

    const result = await app.request("/api/site-config", { method: "GET" }, {
      DB: {},
      SIGNING_SECRET: "test-secret",
      SITE_NAME: "Test Guild",
      SITE_LOGO_URL: "/test-logo.webp",
    });
    const body = await result.json() as { error_code: string };

    expect(result.status).toBe(404);
    expect(body.error_code).toBe("NOT_FOUND");
  });

  it("requires admin.siteConfig.manage for admin site config reads and writes", async () => {
    const { adminRoutes } = await import("./admin");
    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));

    const readResult = await adminRoutes.request("/site-config", { method: "GET" }, { DB: {} });

    expect(readResult.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(expect.anything(), "admin.siteConfig.manage");

    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));
    const writeResult = await adminRoutes.request("/site-config", {
      method: "PATCH",
      body: JSON.stringify({ site_name: "Guild" }),
      headers: { "Content-Type": "application/json" },
    }, { DB: {} });

    expect(writeResult.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(expect.anything(), "admin.siteConfig.manage", { freshPermissions: true });

    mocks.requirePermission.mockRejectedValueOnce(new HTTPException(401));
    const form = new FormData();
    form.set("file", new File(["logo"], "logo.webp", { type: "image/webp" }));
    const uploadResult = await adminRoutes.request("/site-config/logo", {
      method: "POST",
      body: form,
    }, { DB: {} });

    expect(uploadResult.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenLastCalledWith(expect.anything(), "admin.siteConfig.manage", { freshPermissions: true });
  });

  it("requires a session for member onboarding progress", async () => {
    const { onboardingRoutes } = await import("./site-config");
    mocks.getRequestUser.mockResolvedValueOnce(null);

    const result = await onboardingRoutes.request("/", { method: "GET" }, { DB: {} });

    expect(result.status).toBe(401);
    expect(siteConfigServiceMethods.getMemberOnboarding).not.toHaveBeenCalled();
  });
});
