import { beforeEach, describe, expect, it, vi } from "vitest";

const listArticles = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    data: { data: [], total: 0, page: 1, limit: 50, total_pages: 1 },
  }),
);

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock("../services/WikiService", () => ({
  WikiService: vi.fn(function WikiServiceMock(this: { listArticles: typeof listArticles }) {
    this.listArticles = listArticles;
  }),
}));

describe("wiki article filters", () => {
  beforeEach(() => {
    listArticles.mockClear();
  });

  it("passes every repeated category_id to the service", async () => {
    const { wikiRoutes } = await import("./wiki");
    const response = await wikiRoutes.request(
      "/articles?page=1&limit=50&category_id=category-1&category_id=category-2",
      { method: "GET" },
      { DB: {}, MEDIA: {} },
    );

    expect(response.status).toBe(200);
    expect(listArticles).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      categoryIds: ["category-1", "category-2"],
      archived: undefined,
      pinned: undefined,
      search: undefined,
    });
  });
});
