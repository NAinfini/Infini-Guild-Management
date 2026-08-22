// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWikiArticles } from "./wiki";
import { queryKeys } from "../query-keys";

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
      sort: "updated_asc",
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("search")).toBe("build");
    expect(params.get("pinned")).toBe("true");
    expect(params.get("sort")).toBe("updated_asc");
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

  it("uses curated sorting when sort is omitted", async () => {
    await fetchWikiArticles({ page: 1, limit: 50 });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("sort")).toBe("curated");
  });

  it("includes sort in the article query key", () => {
    const curated = queryKeys.wiki.articles("all", "", "active", false, "curated");
    const updated = queryKeys.wiki.articles("all", "", "active", false, "updated_asc");

    expect(curated).not.toEqual(updated);
    expect(curated.at(-1)).toBe("curated");
  });
});
