import type { Bindings } from "../index";
import { SystemTestService } from "../services/SystemTestService";

export type SystemTestCleanupSummary = {
  processed: number;
  completed: number;
  manualReview: number;
};

/**
 * Backstop for abandoned admin API test tabs. It only replays registry-backed
 * exact-ID cleanup; historical marker text is intentionally never inspected.
 */
export async function runSystemTestCleanupCron(env: Bindings): Promise<SystemTestCleanupSummary> {
  return new SystemTestService(env).cleanupStaleRuns();
}
