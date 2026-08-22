import { describe, expect, it, vi } from "vitest";
import { CloudflareAdminOperationsRuntime } from "./admin-operations-realtime.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

describe("CloudflareAdminOperationsRuntime", () => {
  it("returns the exact notification Durable Object count and its observation time", async () => {
    const fetch = vi.fn(async () => Response.json({
      observed_at: "2026-08-12T11:59:59.000Z",
      connection_count: 7,
    }));

    await expect(new CloudflareAdminOperationsRuntime({ fetch }, () => NOW).readRealtime()).resolves.toEqual({
      state: "available",
      runtimeSource: "cloudflare-notifications-do",
      observedAt: "2026-08-12T11:59:59.000Z",
      connectionCount: 7,
    });
    expect(fetch).toHaveBeenCalledWith("https://notifications.internal/status", { method: "GET" });
  });

  it("reports unavailable without inventing a connection count", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Durable Object unavailable"));

    await expect(new CloudflareAdminOperationsRuntime({ fetch }, () => NOW).readRealtime()).resolves.toEqual({
      state: "unavailable",
      runtimeSource: "cloudflare-notifications-do",
      observedAt: NOW.toISOString(),
      connectionCount: null,
    });
  });
});
