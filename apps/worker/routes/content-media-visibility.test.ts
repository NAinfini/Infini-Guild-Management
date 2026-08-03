import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  requirePermission: vi.fn(),
  requireSessionUser: vi.fn(),
  serveR2Object: vi.fn(),
}));

vi.mock("../middleware/rbac", () => ({
  getRequestUser: mocks.getRequestUser,
  requirePermission: mocks.requirePermission,
}));

vi.mock("./_shared", async () => {
  const actual = await vi.importActual<typeof import("./_shared")>("./_shared");
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
    requireSessionUser: mocks.requireSessionUser,
    serveR2Object: mocks.serveR2Object,
  };
});

function dbWithResult(result: { present: number } | null) {
  const first = vi.fn().mockResolvedValue(result);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  return { DB: { prepare }, prepare, bind, first };
}

describe("content media visibility", () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset().mockResolvedValue(null);
    mocks.requirePermission.mockReset();
    mocks.requireSessionUser.mockReset().mockResolvedValue({ id: "member-1", permissions: new Set() });
    mocks.serveR2Object.mockReset().mockResolvedValue(new Response("media"));
  });

  it("serves an active announcement upload lease only to its owner", async () => {
    const { announcementsRoutes } = await import("./announcements");
    const env = dbWithResult({ present: 1 });
    mocks.getRequestUser.mockResolvedValueOnce({ id: "owner-1", permissions: new Set() });
    const key = "announcement/Abcdefghijklmnopqrstu/images/object-1.webp";

    const response = await announcementsRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(env.bind).toHaveBeenCalledWith(key, "Abcdefghijklmnopqrstu", "owner-1", expect.any(String), 0);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("lease.owner_user_id = ?3");
    expect(env.prepare.mock.calls[0]?.[0]).toContain("lease.expires_at > ?4");
  });

  it.each([
    ["another user", "other-1"],
    ["the owner after expiry", "owner-1"],
  ])("does not serve an unreferenced announcement lease to %s", async (_label, viewerId) => {
    const { announcementsRoutes } = await import("./announcements");
    const env = dbWithResult(null);
    mocks.getRequestUser.mockResolvedValueOnce({ id: viewerId, permissions: new Set() });
    const key = "announcement/Abcdefghijklmnopqrstu/images/object-1.webp";

    const response = await announcementsRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(404);
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });

  it("serves a consumed announcement lease through its visible persistent reference", async () => {
    const { announcementsRoutes } = await import("./announcements");
    const env = dbWithResult({ present: 1 });
    const key = "announcement/Abcdefghijklmnopqrstu/images/object-1.webp";

    const response = await announcementsRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("INNER JOIN announcements");
    expect(env.prepare.mock.calls[0]?.[0]).toContain("announcement.status IN ('published', 'archived')");
  });

  it("requires an exact event reference, attachment, and visible event", async () => {
    const { eventsRoutes } = await import("./events");
    const env = dbWithResult({ present: 1 });
    const key = "events/event-1/images/object-1.webp";

    const response = await eventsRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("INNER JOIN events");
    expect(env.prepare.mock.calls[0]?.[0]).toContain("FROM json_each");
    expect(env.bind).toHaveBeenCalledWith(key, "event-1", 0, expect.any(String));
  });

  it("does not serve an unreferenced wiki object with a valid prefix", async () => {
    const { wikiRoutes } = await import("./wiki");
    const env = dbWithResult(null);
    const key = "wiki/article-1/images/object-1.webp";

    const response = await wikiRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(404);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("INNER JOIN wiki_articles");
  });

  it("serves an active wiki upload lease to its owner before the article is saved", async () => {
    const { wikiRoutes } = await import("./wiki");
    const env = dbWithResult({ present: 1 });
    const key = "wiki/article-1/images/object-1.webp";
    mocks.getRequestUser.mockResolvedValueOnce({ id: "owner-1", permissions: new Set() });

    const response = await wikiRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(env.bind).toHaveBeenCalledWith(key, "article-1", "owner-1", expect.any(String));
    expect(env.prepare.mock.calls[0]?.[0]).toContain("lease.owner_user_id = ?3");
    expect(env.prepare.mock.calls[0]?.[0]).toContain("lease.expires_at > ?4");
  });

  it.each([
    ["another user", "other-1"],
    ["the owner after expiry", "owner-1"],
  ])("does not serve an unreferenced wiki lease to %s", async (_label, viewerId) => {
    const { wikiRoutes } = await import("./wiki");
    const env = dbWithResult(null);
    const key = "wiki/article-1/images/object-1.webp";
    mocks.getRequestUser.mockResolvedValueOnce({ id: viewerId, permissions: new Set() });

    const response = await wikiRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(404);
    expect(mocks.serveR2Object).not.toHaveBeenCalled();
  });

  it("serves a consumed wiki lease through its persistent article reference", async () => {
    const { wikiRoutes } = await import("./wiki");
    const env = dbWithResult({ present: 1 });
    const key = "wiki/article-1/images/object-1.webp";

    const response = await wikiRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("INNER JOIN wiki_articles");
  });

  it("requires a gallery item whose exact URL is the referenced key", async () => {
    const { galleryRoutes } = await import("./gallery");
    const env = dbWithResult(null);
    const key = "gallery/users/uploader-1/items/item-1/images/object-1.webp";

    const response = await galleryRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(404);
    expect(env.prepare.mock.calls[0]?.[0]).toContain("item.url = ?1");
    expect(env.bind).toHaveBeenCalledWith(key, "item-1");
  });

  it("serves an exact storage image reference to a signed-in member", async () => {
    const { storageRoutes } = await import("./storage");
    const env = dbWithResult({ present: 1 });
    const key = "storage/items/item-1/object-1.webp";

    const response = await storageRoutes.request(`/image?key=${encodeURIComponent(key)}`, {}, { DB: env.DB, MEDIA: {} });

    expect(response.status).toBe(200);
    expect(mocks.requireSessionUser).toHaveBeenCalled();
    expect(env.prepare.mock.calls[0]?.[0]).toContain("INNER JOIN storage_item_images");
    expect(env.bind).toHaveBeenCalledWith(key, "item-1");
  });
});
