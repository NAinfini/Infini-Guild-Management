import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@guild/shared/config/limits";
import { fetchBadgeAssignments } from "./badges";

const clientMocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../client", () => clientMocks);

describe("badge assignment queries", () => {
  beforeEach(() => clientMocks.apiRequest.mockReset());

  it("follows stable cursor pages and returns the complete management baseline", async () => {
    clientMocks.apiRequest
      .mockResolvedValueOnce({ data: [{ user_id: "user-1" }], next_cursor: "next-page" })
      .mockResolvedValueOnce({ data: [{ user_id: "user-2" }], next_cursor: null });

    await expect(fetchBadgeAssignments("badge-1")).resolves.toEqual([
      { user_id: "user-1" },
      { user_id: "user-2" },
    ]);
    expect(clientMocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      `/api/badges/badge-1/assignments?limit=${LIMITS.pagination.badgeAssignments}`,
    );
    expect(clientMocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      `/api/badges/badge-1/assignments?limit=${LIMITS.pagination.badgeAssignments}&cursor=next-page`,
    );
  });

  it("fails instead of looping forever when a server repeats a cursor", async () => {
    clientMocks.apiRequest
      .mockResolvedValueOnce({ data: [], next_cursor: "same" })
      .mockResolvedValueOnce({ data: [], next_cursor: "same" });
    await expect(fetchBadgeAssignments("badge-1")).rejects.toThrow("cursor did not advance");
  });
});
