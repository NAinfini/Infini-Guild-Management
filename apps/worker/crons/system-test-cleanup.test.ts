import { describe, expect, it, vi } from "vitest";

const cleanupStaleRuns = vi.fn();
vi.mock("../services/SystemTestService", () => ({
  SystemTestService: class { cleanupStaleRuns = cleanupStaleRuns; },
}));

import { runSystemTestCleanupCron } from "./system-test-cleanup";

describe("system test cleanup cron", () => {
  it("only delegates abandoned registered runs to the exact-ID cleanup engine", async () => {
    cleanupStaleRuns.mockResolvedValueOnce({ processed: 1, completed: 1, manualReview: 0 });
    await expect(runSystemTestCleanupCron({} as never)).resolves.toEqual({ processed: 1, completed: 1, manualReview: 0 });
    expect(cleanupStaleRuns).toHaveBeenCalledTimes(1);
  });
});
