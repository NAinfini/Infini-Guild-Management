import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch-timeout.js";

describe("fetchWithTimeout", () => {
  it("gives external requests one bounded abort signal", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout(fetcher, "https://provider.example", undefined, 10))
      .rejects.toThrow("External request timed out");
    expect(fetcher).toHaveBeenCalledWith("https://provider.example", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it("propagates an upstream cancellation into the external request", async () => {
    const upstream = new AbortController();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const pending = fetchWithTimeout(fetcher, "https://provider.example", { signal: upstream.signal }, 1_000);

    upstream.abort(new Error("request cancelled"));
    await expect(pending).rejects.toThrow("request cancelled");
  });
});
