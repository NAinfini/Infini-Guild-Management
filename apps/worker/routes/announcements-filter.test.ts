import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    data: { data: [], total: 0, page: 1, limit: 20, total_pages: 1 },
  }),
);
const getRequestUser = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock("../middleware/rbac", () => ({
  getRequestUser,
  requirePermission: vi.fn(),
}));

vi.mock("../services/AnnouncementService", () => ({
  AnnouncementService: vi.fn(function AnnouncementServiceMock(this: { list: typeof list }) {
    this.list = list;
  }),
}));

vi.mock("./service-factory", () => ({
  withMediaAndPublishAnnouncement: vi.fn(() => ({})),
}));

describe("announcement list sorting", () => {
  beforeEach(() => {
    list.mockClear();
    getRequestUser.mockClear();
  });

  it("uses updated_desc when sort is omitted", async () => {
    const { announcementsRoutes } = await import("./announcements");
    const response = await announcementsRoutes.request(
      "/",
      { method: "GET" },
      { DB: {}, MEDIA: {}, SIGNING_SECRET: "test" },
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      sort: "updated_desc",
    }));
  });

  it.each(["updated_desc", "updated_asc"] as const)(
    "passes the %s sort to the service",
    async (sort) => {
      const { announcementsRoutes } = await import("./announcements");
      const response = await announcementsRoutes.request(
        `/?sort=${sort}`,
        { method: "GET" },
        { DB: {}, MEDIA: {}, SIGNING_SECRET: "test" },
      );

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ sort }));
    },
  );

  it("rejects an unsupported sort", async () => {
    const { announcementsRoutes } = await import("./announcements");
    const response = await announcementsRoutes.request(
      "/?sort=recent",
      { method: "GET" },
      { DB: {}, MEDIA: {}, SIGNING_SECRET: "test" },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
    });
    expect(list).not.toHaveBeenCalled();
  });
});
