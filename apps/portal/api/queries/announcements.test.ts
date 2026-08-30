// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../query-keys";
import { fetchAnnouncements } from "./announcements";

const clientMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: clientMocks.apiRequest,
}));

describe("announcement queries", () => {
  beforeEach(() => {
    clientMocks.apiRequest.mockReset();
    clientMocks.apiRequest.mockResolvedValue({ data: [] });
  });

  it("serializes an explicit sort", async () => {
    await fetchAnnouncements({
      page: 1,
      limit: 20,
      sort: "updated_asc",
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("sort")).toBe("updated_asc");
  });

  it("uses updated_desc when sort is omitted", async () => {
    await fetchAnnouncements({ page: 1, limit: 20 });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("sort")).toBe("updated_desc");
  });

  it("uses status as the only lifecycle filter", async () => {
    await fetchAnnouncements({ page: 1, limit: 20, status: "archived" });
    const params = new URLSearchParams((clientMocks.apiRequest.mock.calls[0]?.[0] as string).split("?")[1]);
    expect(params.get("status")).toBe("archived");
    expect(params.has("archived")).toBe(false);
  });

  it("includes sort in the list query key", () => {
    const descending = queryKeys.announcements.list("all", "all", "", "updated_desc");
    const ascending = queryKeys.announcements.list("all", "all", "", "updated_asc");

    expect(descending).not.toEqual(ascending);
    expect(descending.at(-1)).toBe("updated_desc");
  });
});
