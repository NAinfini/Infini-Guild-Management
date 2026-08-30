import type { RateLimiter } from "@guild/kernel";
import { describe, expect, it, vi } from "vitest";
import { CloudflareConsistentAuthRateLimiter, CloudflareRateLimiter } from "./rate-limiter.js";

function target(response: Response) {
  const fetch = vi.fn(async () => response);
  const get = vi.fn(() => ({ fetch }));
  const idFromName = vi.fn(() => "bucket-id" as unknown as DurableObjectId);
  return {
    fetch,
    get,
    idFromName,
    target: { get, idFromName } as unknown as DurableObjectNamespace,
  };
}

describe("Cloudflare rate limiters", () => {
  it("normalizes binding keys and returns a fixed retry delay", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limiter = new CloudflareRateLimiter({ limit } as unknown as RateLimit, 60);

    await expect(limiter.consume("  login-key  ")).resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limit).toHaveBeenCalledWith({ key: "login-key" });
    await expect(limiter.consume(" ")).rejects.toThrow("Rate-limit key is required");
  });

  it("uses the native binding first and then an exact Durable Object bucket", async () => {
    const firstLayer: RateLimiter = { consume: vi.fn(async () => ({ allowed: true })) };
    const durable = target(Response.json({ allowed: false, retryAfterSeconds: 17 }));
    const limiter = new CloudflareConsistentAuthRateLimiter(firstLayer, durable.target, "login_pair");

    await expect(limiter.consume(" auth:login:name:source:member "))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 17 });
    expect(firstLayer.consume).toHaveBeenCalledWith("auth:login:name:source:member");
    expect(durable.idFromName).toHaveBeenCalledWith(
      "auth-login-rate-limit:login_pair:auth:login:name:source:member",
    );
    expect(durable.fetch).toHaveBeenCalledWith("https://auth-rate-limit.internal/consume", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ scope: "login_pair" }),
    }));
  });

  it("does not contact the Durable Object after a first-layer denial", async () => {
    const firstLayer: RateLimiter = { consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 60 })) };
    const durable = target(Response.json({ allowed: true }));
    const limiter = new CloudflareConsistentAuthRateLimiter(firstLayer, durable.target, "ip");

    await expect(limiter.consume("auth:login:ip:203.0.113.9"))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(durable.get).not.toHaveBeenCalled();
  });

  it("uses a distinct source-wide Durable Object identity", async () => {
    const firstLayer: RateLimiter = { consume: vi.fn(async () => ({ allowed: true })) };
    const durable = target(Response.json({ allowed: true }));
    const limiter = new CloudflareConsistentAuthRateLimiter(firstLayer, durable.target, "ip");

    await expect(limiter.consume("auth:login:ip:203.0.113.9")).resolves.toEqual({ allowed: true });
    expect(durable.idFromName).toHaveBeenCalledWith(
      "auth-login-rate-limit:ip:auth:login:ip:203.0.113.9",
    );
  });

  it("keeps non-login authentication operations on the existing binding only", async () => {
    const firstLayer: RateLimiter = { consume: vi.fn(async () => ({ allowed: true })) };
    const durable = target(Response.json({ allowed: true }));
    const limiter = new CloudflareConsistentAuthRateLimiter(firstLayer, durable.target, "login_pair");

    await expect(limiter.consume("auth:register:203.0.113.9")).resolves.toEqual({ allowed: true });
    expect(durable.get).not.toHaveBeenCalled();
  });

  it("fails closed when the Durable Object response is unavailable or malformed", async () => {
    const firstLayer: RateLimiter = { consume: vi.fn(async () => ({ allowed: true })) };
    const unavailable = target(new Response("unavailable", { status: 503 }));
    const malformed = target(Response.json({ allowed: false }));

    await expect(new CloudflareConsistentAuthRateLimiter(firstLayer, unavailable.target, "ip")
      .consume("auth:login:ip:203.0.113.9")).rejects.toThrow("Durable Object is unavailable");
    await expect(new CloudflareConsistentAuthRateLimiter(firstLayer, malformed.target, "ip")
      .consume("auth:login:ip:203.0.113.9")).rejects.toThrow("Invalid authentication rate-limit response");
  });
});
