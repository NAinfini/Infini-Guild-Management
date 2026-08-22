import { describe, expect, it } from "vitest";
import { VpsAdminOperationsRuntime } from "./admin-operations-realtime.js";

const NOW = "2026-08-12T12:00:00.000Z";

describe("VpsAdminOperationsRuntime", () => {
  it("reads the exact in-process hub connection count", async () => {
    await expect(new VpsAdminOperationsRuntime(() => 4, () => NOW).readRealtime()).resolves.toEqual({
      state: "available",
      runtimeSource: "vps-notification-hub",
      observedAt: NOW,
      connectionCount: 4,
    });
  });

  it("reports unavailable when the hub cannot provide a count", async () => {
    await expect(new VpsAdminOperationsRuntime(() => null, () => NOW).readRealtime()).resolves.toEqual({
      state: "unavailable",
      runtimeSource: "vps-notification-hub",
      observedAt: NOW,
      connectionCount: null,
    });
  });
});
