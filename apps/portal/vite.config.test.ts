import { describe, expect, it } from "vitest";
import { shouldProxyApiRequest } from "./vite.config";

describe("portal Vite API proxy", () => {
  it("proxies API requests with ISO datetime query strings", () => {
    expect(
      shouldProxyApiRequest(
        "/api/events?page=1&limit=20&archived=false&start_after=2026-05-06T20%3A30%3A00.000Z&start_before=2026-05-13T20%3A30%3A00.000Z",
      ),
    ).toBe(true);
  });

  it("does not proxy non-API asset paths", () => {
    expect(shouldProxyApiRequest("/main.tsx?t=1778099261065")).toBe(false);
  });

  it("does not proxy portal source modules under the api directory", () => {
    expect(shouldProxyApiRequest("/api/client.ts")).toBe(false);
    expect(shouldProxyApiRequest("/api/queries/events.ts?t=1778099261065")).toBe(false);
    expect(shouldProxyApiRequest("/api/query-keys.ts")).toBe(false);
  });
});
