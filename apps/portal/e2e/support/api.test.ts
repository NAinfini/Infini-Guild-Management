import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupSystemTestRun,
  SYSTEM_TEST_CLEANUP_POLL_MS,
  SYSTEM_TEST_CLEANUP_TIMEOUT_MS,
  type SystemTestCleanupApi,
  type SystemTestCleanupResponse,
} from "./system-test-cleanup.js";

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): SystemTestCleanupResponse {
  const text = JSON.stringify(body);
  return {
    headers: () => headers,
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: async () => text,
  };
}

describe("system-test E2E cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function clock() {
    let milliseconds = 0;
    const waits: number[] = [];
    return {
      now: () => milliseconds,
      sleep: async (duration: number) => {
        waits.push(duration);
        milliseconds += duration;
      },
      waits,
    };
  }

  it("continues past 100 bounded cleanup pages at a paced cadence", async () => {
    const responses = [
      ...Array.from({ length: 101 }, () => response(409, { ok: false, status: "cleaning" })),
      response(200, { ok: true, status: "completed" }),
      response(200, { ok: true }),
    ];
    const post = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("cleanup made an unexpected request");
      return next;
    });
    const timing = clock();

    await expect(cleanupSystemTestRun({ post } as SystemTestCleanupApi, "run-1", timing))
      .resolves.toBeUndefined();

    expect(post).toHaveBeenCalledTimes(103);
    expect(timing.waits).toEqual(Array.from({ length: 101 }, () => SYSTEM_TEST_CLEANUP_POLL_MS));
  });

  it("honors Retry-After without consuming a cleanup page", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(response(409, { ok: false, status: "cleaning" }))
      .mockResolvedValueOnce(response(429, {
        error_code: "RATE_LIMITED",
        details: { retry_after_seconds: 1 },
      }, { "retry-after": "1" }))
      .mockResolvedValueOnce(response(200, { ok: true, status: "completed" }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const timing = clock();

    await expect(cleanupSystemTestRun({ post } as SystemTestCleanupApi, "run-1", timing))
      .resolves.toBeUndefined();

    expect(post.mock.calls.map(([path]) => path)).toEqual([
      "/api/admin/status/system-test-runs/run-1/cleanup",
      "/api/admin/status/system-test-runs/run-1/cleanup",
      "/api/admin/status/system-test-runs/run-1/cleanup",
      "/api/admin/status/system-test-runs/run-1/finalize",
    ]);
    expect(timing.waits).toEqual([SYSTEM_TEST_CLEANUP_POLL_MS, 1_000]);
  });

  it("treats a running cleanup lease as transient", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(response(409, { ok: false, status: "running" }))
      .mockResolvedValueOnce(response(200, { ok: true, status: "completed" }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const timing = clock();

    await expect(cleanupSystemTestRun({ post } as SystemTestCleanupApi, "run-1", timing))
      .resolves.toBeUndefined();

    expect(timing.waits).toEqual([SYSTEM_TEST_CLEANUP_POLL_MS]);
  });

  it("rejects a rate-limit response without a valid Retry-After", async () => {
    const post = vi.fn().mockResolvedValue(response(429, {
      error_code: "RATE_LIMITED",
      details: { retry_after_seconds: 0 },
    }));
    const timing = clock();

    await expect(cleanupSystemTestRun({ post } as SystemTestCleanupApi, "run-1", timing))
      .rejects.toThrow(/valid Retry-After/);
  });

  it("stops when the bounded cleanup window expires", async () => {
    const post = vi.fn().mockResolvedValue(response(409, { ok: false, status: "cleaning" }));
    const timing = clock();

    await expect(cleanupSystemTestRun({ post } as SystemTestCleanupApi, "run-1", timing))
      .rejects.toThrow(`did not complete within ${SYSTEM_TEST_CLEANUP_TIMEOUT_MS}ms`);

    const expectedPolls = SYSTEM_TEST_CLEANUP_TIMEOUT_MS / SYSTEM_TEST_CLEANUP_POLL_MS;
    expect(post).toHaveBeenCalledTimes(expectedPolls);
    expect(timing.waits).toHaveLength(expectedPolls);
  });
});
