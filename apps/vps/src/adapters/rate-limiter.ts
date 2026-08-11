import type { RateLimitDecision, RateLimiter } from "@guild/kernel";

export type NodeRateLimiterOptions = Readonly<{
  limit: number;
  windowMs: number;
  maxEntries: number;
  now?: () => number;
}>;

type Counter = {
  count: number;
  expiresAt: number;
};

export class NodeRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;
  private nextSweepAt = Number.POSITIVE_INFINITY;

  constructor(private readonly options: NodeRateLimiterOptions) {
    for (const [field, value] of Object.entries({
      limit: options.limit,
      windowMs: options.windowMs,
      maxEntries: options.maxEntries,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
    }
    this.now = options.now ?? Date.now;
  }

  async consume(key: string): Promise<RateLimitDecision> {
    const normalized = key.trim();
    if (!normalized) throw new TypeError("Rate-limit key is required");
    const now = this.now();
    const current = this.counters.get(normalized);
    if (current && current.expiresAt > now) {
      if (current.count >= this.options.limit) return this.denied(current.expiresAt, now);
      current.count += 1;
      return { allowed: true };
    }
    if (current) this.counters.delete(normalized);

    if (this.counters.size >= this.options.maxEntries && now >= this.nextSweepAt) {
      this.sweepExpired(now);
    }
    if (this.counters.size >= this.options.maxEntries) {
      return this.denied(this.nextSweepAt, now);
    }
    const expiresAt = now + this.options.windowMs;
    this.counters.set(normalized, { count: 1, expiresAt });
    this.nextSweepAt = Math.min(this.nextSweepAt, expiresAt);
    return { allowed: true };
  }

  private sweepExpired(now: number): void {
    let nextSweepAt = Number.POSITIVE_INFINITY;
    for (const [candidate, counter] of this.counters) {
      if (counter.expiresAt <= now) this.counters.delete(candidate);
      else nextSweepAt = Math.min(nextSweepAt, counter.expiresAt);
    }
    this.nextSweepAt = nextSweepAt;
  }

  private denied(expiresAt: number, now: number): RateLimitDecision {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1_000)),
    };
  }
}
