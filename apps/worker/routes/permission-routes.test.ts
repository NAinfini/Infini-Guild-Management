import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../services/GalleryService", () => ({
  GalleryService: vi.fn(function GalleryServiceMock(this: { deleteItem: typeof galleryDeleteItem }) {
    this.deleteItem = galleryDeleteItem;
  }),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

describe("route permission mapping", () => {
  beforeEach(() => {
    mocks.requirePermission.mockReset();
    mocks.getRequestUser.mockReset();
    galleryDeleteItem.mockClear();
  });

  it("uses announcements.archive for announcement archive route", async () => {
    const { announcementsRoutes } = await import("./announcements");
    const response = new Response("blocked", { status: 418 });
    mocks.requirePermission.mockResolvedValueOnce(response);

    const result = await announcementsRoutes.request("/announcement-1", { method: "DELETE" });

    expect(result.status).toBe(418);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "announcements.archive");
  });

  it("uses wiki.articles.archive for wiki article archive route", async () => {
    const { wikiRoutes } = await import("./wiki");
    const response = new Response("blocked", { status: 418 });
    mocks.requirePermission.mockResolvedValueOnce(response);

    const result = await wikiRoutes.request("/articles/article-1", { method: "DELETE" });

    expect(result.status).toBe(418);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "wiki.articles.archive");
  });

  it("uses session auth and passes gallery.delete capability for gallery item delete", async () => {
    const { galleryRoutes } = await import("./gallery");
    mocks.getRequestUser.mockResolvedValueOnce({
      id: "u-1",
      role: "member",
      permissions: new Set(["gallery.delete"]),
    });
    mocks.requirePermission.mockResolvedValueOnce(new Response("blocked", { status: 418 }));

    const result = await galleryRoutes.request("/item-1", { method: "DELETE" }, { DB: {}, MEDIA: {} });

    expect(result.status).toBe(200);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(galleryDeleteItem).toHaveBeenCalledWith("u-1", true, "item-1");
  });
});
