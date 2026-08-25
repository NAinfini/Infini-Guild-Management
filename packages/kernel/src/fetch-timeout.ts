export const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("External request timeout must be a positive integer");
  }
  const controller = new AbortController();
  const upstream = init?.signal;
  const abort = () => controller.abort(upstream?.reason);
  if (upstream?.aborted) abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("External request timed out")), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", abort);
  }
}
