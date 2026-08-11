import { afterEach, describe, expect, it, vi } from "vitest";
import type { VpsServerRuntime } from "./runtime/server-runtime.js";

afterEach(() => {
  vi.doUnmock("./runtime/config.js");
  vi.doUnmock("./runtime/server-runtime.js");
  vi.resetModules();
});

describe("VPS executable entry", () => {
  it("is import-safe and installs signal handlers before awaiting startup", async () => {
    const readConfig = vi.fn();
    const createRuntime = vi.fn();
    vi.doMock("./runtime/config.js", () => ({ readVpsRuntimeConfig: readConfig }));
    vi.doMock("./runtime/server-runtime.js", () => ({ createVpsServerRuntime: createRuntime }));

    const entry = await import("./index.js");
    expect(readConfig).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();

    const initialInterruptHandlers = new Set(process.listeners("SIGINT"));
    const initialTerminateHandlers = new Set(process.listeners("SIGTERM"));
    const runtime = {
      state: "idle",
      start: vi.fn(async () => {
        expect(process.listeners("SIGINT").some((handler) => !initialInterruptHandlers.has(handler))).toBe(true);
        expect(process.listeners("SIGTERM").some((handler) => !initialTerminateHandlers.has(handler))).toBe(true);
      }),
      stop: vi.fn(async () => undefined),
      handleHttp: vi.fn(),
      handleUpgrade: vi.fn(),
    } as unknown as VpsServerRuntime;

    try {
      await entry.main(runtime);
    } finally {
      for (const handler of process.listeners("SIGINT")) {
        if (!initialInterruptHandlers.has(handler)) process.off("SIGINT", handler);
      }
      for (const handler of process.listeners("SIGTERM")) {
        if (!initialTerminateHandlers.has(handler)) process.off("SIGTERM", handler);
      }
    }
    expect(runtime.start).toHaveBeenCalledOnce();
  });
});
