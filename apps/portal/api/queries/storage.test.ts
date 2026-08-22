// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStorageItems } from "./storage";

const clientMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: clientMocks.apiRequest,
}));

describe("storage queries", () => {
  beforeEach(() => {
    clientMocks.apiRequest.mockReset();
    clientMocks.apiRequest.mockResolvedValue({ data: [], next_cursor: null });
  });

  it("serializes the complete inventory cursor contract", async () => {
    await fetchStorageItems({
      storageId: "storage-1",
      categoryId: "category-1",
      search: "moon blade",
      stock: "available",
      cursor: "opaque-cursor",
      limit: 24,
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("storage_id")).toBe("storage-1");
    expect(params.get("category_id")).toBe("category-1");
    expect(params.get("search")).toBe("moon blade");
    expect(params.get("stock")).toBe("available");
    expect(params.get("cursor")).toBe("opaque-cursor");
    expect(params.get("limit")).toBe("24");
  });

  it("omits optional filters and cursor from the first page", async () => {
    await fetchStorageItems({
      storageId: "storage-1",
      stock: "all",
      limit: 24,
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("stock")).toBe("all");
    expect(params.get("limit")).toBe("24");
    expect(params.has("category_id")).toBe(false);
    expect(params.has("search")).toBe(false);
    expect(params.has("cursor")).toBe(false);
  });
});
