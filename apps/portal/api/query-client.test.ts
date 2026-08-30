// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./client";
import { queryClient, shouldRetryQuery } from "./query-client";

function apiError(status: number) {
  return new ApiRequestError(`status ${status}`, { status });
}

describe("query client retries", () => {
  it.each([400, 401, 403, 404, 409, 429])(
    "does not retry deterministic status %s",
    (status) => {
      expect(shouldRetryQuery(0, apiError(status))).toBe(false);
    },
  );

  it("retries one network or transient server failure", () => {
    for (const status of [0, 500, 502, 503, 504]) {
      expect(shouldRetryQuery(0, apiError(status))).toBe(true);
      expect(shouldRetryQuery(1, apiError(status))).toBe(false);
    }
    expect(shouldRetryQuery(0, new Error("network"))).toBe(true);
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});
