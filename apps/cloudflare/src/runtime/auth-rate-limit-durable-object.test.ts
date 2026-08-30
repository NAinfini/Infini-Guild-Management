import { LIMITS } from "@guild/shared/config/limits";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRateLimitDO } from "./auth-rate-limit-durable-object.js";

class MemoryStorage {
  value: unknown;
  alarm: number | null = null;

  async get<T>(_key: string): Promise<T | undefined> {
    return this.value as T | undefined;
  }

  async put(_key: string, value: unknown): Promise<void> {
    this.value = value;
  }

  async delete(_key: string): Promise<boolean> {
    const existed = this.value !== undefined;
    this.value = undefined;
    return existed;
  }

  async setAlarm(value: number): Promise<void> {
    this.alarm = value;
  }
}

function consume(scope: "ip" | "login_pair"): Request {
  return new Request("https://auth-rate-limit.internal/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope }),
  });
}

describe("AuthRateLimitDO", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes one login-pair bucket and cleans it up when its window expires", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const storage = new MemoryStorage();
    const object = new AuthRateLimitDO({ storage } as unknown as DurableObjectState);

    const responses = await Promise.all(Array.from(
      { length: LIMITS.rateLimit.auth.maxRequests + 1 },
      () => object.fetch(consume("login_pair")),
    ));
    const decisions = await Promise.all(responses.map((response) => response.json() as Promise<{
      allowed: boolean;
      retryAfterSeconds?: number;
    }>));

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(LIMITS.rateLimit.auth.maxRequests);
    expect(decisions.find((decision) => !decision.allowed)).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(storage.alarm).toBe(LIMITS.rateLimit.auth.windowMs);

    now = LIMITS.rateLimit.auth.windowMs;
    await object.alarm();
    expect(storage.value).toBeUndefined();

    await expect(object.fetch(consume("login_pair")).then((response) => response.json()))
      .resolves.toEqual({ allowed: true });
  });

  it("uses the shared source-wide quota and rejects malformed internal requests", async () => {
    let now = 1;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const object = new AuthRateLimitDO({ storage: new MemoryStorage() } as unknown as DurableObjectState);

    for (let index = 0; index < LIMITS.rateLimit.authIp.maxRequests; index += 1) {
      await expect(object.fetch(consume("ip")).then((response) => response.json()))
        .resolves.toEqual({ allowed: true });
    }
    const denied = await object.fetch(consume("ip"));
    await expect(denied.json()).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect((await object.fetch(new Request("https://auth-rate-limit.internal/consume"))).status).toBe(404);
    expect((await object.fetch(new Request("https://auth-rate-limit.internal/consume", {
      method: "POST",
      body: JSON.stringify({ scope: "other" }),
    }))).status).toBe(400);
  });
});
