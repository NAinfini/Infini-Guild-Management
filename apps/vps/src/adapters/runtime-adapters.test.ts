import { describe, expect, it, vi } from "vitest";
import { NodeDeferredTasks } from "./deferred-tasks.js";
import { NodeRateLimiter } from "./rate-limiter.js";

describe("Node runtime adapters", () => {
  it("bounds and drains deferred work", async () => {
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const errors = vi.fn();
    const tasks = new NodeDeferredTasks({ concurrency: 1, maxPending: 2, onError: errors });
    tasks.defer(() => blocker);
    tasks.defer(async () => {
      throw new Error("reported");
    });
    expect(() => tasks.defer(async () => undefined)).not.toThrow();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("queue is full") }));
    release!();
    await tasks.drain();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("contains failures thrown by the deferred error reporter", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tasks = new NodeDeferredTasks({
      concurrency: 1,
      maxPending: 1,
      onError() {
        throw new Error("reporter failed");
      },
    });
    tasks.defer(async () => {
      throw new Error("task failed");
    });

    await expect(tasks.drain()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Deferred task error reporter failed",
      expect.objectContaining({ message: "reporter failed" }),
      { originalError: expect.objectContaining({ message: "task failed" }) },
    );
  });

  it("contains asynchronous rejection from the deferred error reporter", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tasks = new NodeDeferredTasks({
      concurrency: 1,
      maxPending: 1,
      async onError() {
        throw new Error("async reporter failed");
      },
    });
    tasks.defer(async () => {
      throw new Error("task failed");
    });

    await tasks.drain();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalledWith(
      "Deferred task error reporter failed",
      expect.objectContaining({ message: "async reporter failed" }),
      { originalError: expect.objectContaining({ message: "task failed" }) },
    );
  });

  it("enforces a fixed window without an unbounded key map", async () => {
    let now = 1_000;
    const limiter = new NodeRateLimiter({
      limit: 2,
      windowMs: 5_000,
      maxEntries: 1,
      now: () => now,
    });
    expect(await limiter.consume("user-1")).toEqual({ allowed: true });
    expect(await limiter.consume("user-1")).toEqual({ allowed: true });
    expect(await limiter.consume("user-1")).toEqual({ allowed: false, retryAfterSeconds: 5 });
    expect(await limiter.consume("user-2")).toEqual({ allowed: false, retryAfterSeconds: 5 });

    now += 5_000;
    expect(await limiter.consume("user-2")).toEqual({ allowed: true });
  });

  it("uses the earliest expiry when a saturated key map rejects new keys", async () => {
    let now = 1_000;
    const limiter = new NodeRateLimiter({
      limit: 1,
      windowMs: 5_000,
      maxEntries: 2,
      now: () => now,
    });
    await limiter.consume("first");
    now += 2_000;
    await limiter.consume("second");

    expect(await limiter.consume("third")).toEqual({ allowed: false, retryAfterSeconds: 3 });
    now += 3_000;
    expect(await limiter.consume("third")).toEqual({ allowed: true });
  });
});
