import type { RateLimitDecision, RateLimiter } from "@guild/kernel";

export class CloudflareRateLimiter implements RateLimiter {
  constructor(
    private readonly binding: RateLimit,
    private readonly retryAfterSeconds: number,
  ) {
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
      throw new TypeError("retryAfterSeconds must be a positive safe integer");
    }
  }

  async consume(key: string): Promise<RateLimitDecision> {
    const normalized = key.trim();
    if (!normalized) throw new TypeError("Rate-limit key is required");
    const outcome = await this.binding.limit({ key: normalized });
    return outcome.success
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: this.retryAfterSeconds };
  }
}
