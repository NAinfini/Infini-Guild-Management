import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWikiArticles } from "./wiki";

const clientMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: clientMocks.apiRequest,
}));

describe("wiki queries", () => {
  beforeEach(() => {
    clientMocks.apiRequest.mockReset();
    clientMocks.apiRequest.mockResolvedValue({ data: [] });
  });

  it("serializes pinned and omits archived for all-status article filters", async () => {
    await fetchWikiArticles({
      page: 1,
      limit: 50,
      search: "build",
      pinned: true,
      archived: undefined,
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("search")).toBe("build");
    expect(params.get("pinned")).toBe("true");
    expect(params.has("archived")).toBe(false);
  });

  it("serializes every selected category for server-side filtering", async () => {
    await fetchWikiArticles({
      page: 1,
      limit: 50,
      category_id: ["category-1", "category-2"],
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.getAll("category_id")).toEqual(["category-1", "category-2"]);
  });
});
