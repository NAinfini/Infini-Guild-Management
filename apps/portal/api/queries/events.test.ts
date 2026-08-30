// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEventDetailBatch, fetchEventsList } from "./events";

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

  it("fails the whole batch when any detail chunk fails", async () => {
    clientMocks.apiRequest
      .mockResolvedValueOnce({ data: [{ id: "event-1" }] })
      .mockRejectedValueOnce(new Error("second chunk failed"));

    await expect(fetchEventDetailBatch(
      Array.from({ length: 51 }, (_, index) => `event-${index + 1}`),
    )).rejects.toThrow("second chunk failed");

    expect(clientMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(clientMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({
      bodyJson: { ids: Array.from({ length: 50 }, (_, index) => `event-${index + 1}`) },
    });
    expect(clientMocks.apiRequest.mock.calls[1]?.[1]).toMatchObject({
      bodyJson: { ids: ["event-51"] },
    });
  });
});
