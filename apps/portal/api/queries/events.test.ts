// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEventsList } from "./events";

const clientMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client", () => ({
  apiRequest: clientMocks.apiRequest,
}));

describe("event queries", () => {
  beforeEach(() => {
    clientMocks.apiRequest.mockReset();
    clientMocks.apiRequest.mockResolvedValue({ data: [] });
  });

  it("serializes server-backed filter params", async () => {
    await fetchEventsList({
      page: 2,
      limit: 25,
      type: "guild_war",
      archived: undefined,
      search: "dragon",
      pinned: true,
      locked: true,
    });

    const url = clientMocks.apiRequest.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/events?");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("25");
    expect(params.get("type")).toBe("guild_war");
    expect(params.has("archived")).toBe(false);
    expect(params.get("search")).toBe("dragon");
    expect(params.get("pinned")).toBe("true");
    expect(params.get("locked")).toBe("true");
  });
});
