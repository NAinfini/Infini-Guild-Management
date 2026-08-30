export type SystemTestCleanupResponse = Readonly<{
  headers(): Record<string, string>;
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
}>;

export type SystemTestCleanupApi = Readonly<{
  post(path: string): Promise<SystemTestCleanupResponse>;
}>;

/* Mutation cleanup shares the normal 80 requests/minute budget. Stay just below
   that ceiling so large runs make steady progress instead of waiting through
   repeated 429 windows. Retry-After remains a bounded recovery path. */
export const SYSTEM_TEST_CLEANUP_POLL_MS = 800;
export const SYSTEM_TEST_CLEANUP_TIMEOUT_MS = 5 * 60 * 1_000;

export type SystemTestCleanupTiming = Readonly<{
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export async function cleanupSystemTestRun(
  adminApi: SystemTestCleanupApi,
  runId: string,
  timing: SystemTestCleanupTiming = {},
): Promise<void> {
  const now = timing.now ?? Date.now;
  const sleep = timing.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + SYSTEM_TEST_CLEANUP_TIMEOUT_MS;
  let rateLimitWaits = 0;
  const wait = async (milliseconds: number): Promise<void> => {
    if (milliseconds > deadline - now()) {
      throw new Error(`cleanup of run ${runId} did not complete within ${SYSTEM_TEST_CLEANUP_TIMEOUT_MS}ms`);
    }
    await sleep(milliseconds);
  };

  while (now() < deadline) {
    const response = await adminApi.post(`/api/admin/status/system-test-runs/${runId}/cleanup`);
    const text = await response.text();
    let body: { ok?: boolean; status?: string };
    try {
      body = JSON.parse(text) as { ok?: boolean; status?: string };
    } catch {
      throw new Error(`cleanup of run ${runId} returned invalid JSON (${response.status()}): ${text}`);
    }
    if (response.ok() && body.ok === true && body.status === "completed") {
      const finalized = await adminApi.post(`/api/admin/status/system-test-runs/${runId}/finalize`);
      if (!finalized.ok()) {
        throw new Error(`finalize of run ${runId} failed (${finalized.status()}): ${await finalized.text()}`);
      }
      return;
    }
    if (response.status() === 409 && body.ok === false
      && (body.status === "running" || body.status === "cleaning")) {
      await wait(SYSTEM_TEST_CLEANUP_POLL_MS);
      continue;
    }
    if (response.status() === 429) {
      const retryAfterSeconds = Number(response.headers()["retry-after"]);
      if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 60) {
        throw new Error(`cleanup of run ${runId} was rate-limited without a valid Retry-After: ${text}`);
      }
      if (rateLimitWaits >= 2) {
        throw new Error(`cleanup of run ${runId} remained rate-limited after 2 bounded waits: ${text}`);
      }
      rateLimitWaits += 1;
      await wait(retryAfterSeconds * 1_000);
      continue;
    }
    throw new Error(`cleanup of run ${runId} failed (${response.status()}): ${text}`);
  }
  throw new Error(`cleanup of run ${runId} did not complete within ${SYSTEM_TEST_CLEANUP_TIMEOUT_MS}ms`);
}
