import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: clientMocks.apiRequest,
}));

import { fetchGuildWarHistory, fetchGuildWarHistoryBatch } from "./guild-war";

describe("guild war queries", () => {
  beforeEach(() => {
    clientMocks.apiRequest.mockReset();
    clientMocks.apiRequest.mockResolvedValue({ data: [] });
  });

  it("sends history search to the server with the pagination filters", async () => {
    await fetchGuildWarHistory({
      page: 2,
      limit: 20,
      date_from: "2026-03-01T00:00:00.000Z",
      date_to: "2026-03-08T23:59:59.999Z",
      search: "Dragon 100%",
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("20");
    expect(params.get("search")).toBe("Dragon 100%");
  });

  it("uses a GET query for the read-only history batch", async () => {
    await fetchGuildWarHistoryBatch(["war-a", "war-b"]);

    const call = clientMocks.apiRequest.mock.calls[0];
    const url = call?.[0] as string;
    const [path, query] = url.split("?");
    expect(path).toBe("/api/guild-war/history/batch");
    expect(new URLSearchParams(query).get("ids")).toBe("war-a,war-b");
    expect(call).toHaveLength(1);
  });
});
