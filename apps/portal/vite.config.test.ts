import { describe, expect, it } from "vitest";
import {
  ECHARTS_CHUNK_BUDGET,
  findEChartsChunkBudgetViolation,
  replaceSiteConfigPlaceholders,
  shouldProxyApiRequest,
} from "./vite.config";

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

describe("portal Vite development HTML", () => {
  it("replaces site config placeholders before the browser requests them", () => {
    const html = [
      "<title>{{SITE_NAME}}</title>",
      '<img src="{{SITE_LOGO_URL}}" alt="">',
    ].join("");

    expect(replaceSiteConfigPlaceholders(html, "Infini Guild", "/guild-logo.webp")).toBe(
      '<title>Infini Guild</title><img src="/guild-logo.webp" alt="">',
    );
  });
});

describe("portal ECharts bundle budget", () => {
  it("accepts the exact raw and gzip limits", () => {
    expect(findEChartsChunkBudgetViolation([
      {
        name: "echarts-core",
        rawBytes: ECHARTS_CHUNK_BUDGET.rawBytes,
        gzipBytes: ECHARTS_CHUNK_BUDGET.gzipBytes,
      },
    ])).toBeNull();
  });

  it("rejects raw or gzip regressions", () => {
    expect(findEChartsChunkBudgetViolation([
      {
        name: "echarts-core",
        rawBytes: ECHARTS_CHUNK_BUDGET.rawBytes + 1,
        gzipBytes: ECHARTS_CHUNK_BUDGET.gzipBytes,
      },
    ])).toContain("raw");

    expect(findEChartsChunkBudgetViolation([
      {
        name: "echarts-core",
        rawBytes: ECHARTS_CHUNK_BUDGET.rawBytes,
        gzipBytes: ECHARTS_CHUNK_BUDGET.gzipBytes + 1,
      },
    ])).toContain("gzip");
  });

  it("keys the budget by stable logical chunk name, not a hashed filename", () => {
    expect(findEChartsChunkBudgetViolation([
      {
        name: "other-chunk",
        rawBytes: ECHARTS_CHUNK_BUDGET.rawBytes * 2,
        gzipBytes: ECHARTS_CHUNK_BUDGET.gzipBytes * 2,
      },
    ])).toBeNull();
  });
});
