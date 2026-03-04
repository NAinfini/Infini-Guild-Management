import { ERROR_STATUS, type StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";

type RateLimitOptions = {
  maxRequests?: number;
  windowMs?: number;
  keyPrefix?: string;
  keyResolver?: (c: Context) => string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 60_000;

function getClientAddress(c: Context): string {
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp) return cfIp;

  const forwardedFor = c.req.header("X-Forwarded-For");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

function pruneExpiredBuckets(nowMs: number): void {
  if (buckets.size < 10_000) {
    return;
  }

  for (const [key, value] of buckets) {
    if (value.resetAt <= nowMs) {
      buckets.delete(key);
    }
  }
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const keyPrefix = options.keyPrefix ?? "global";

  return async function rateLimitMiddleware(c: Context, next: Next): Promise<void> {
    const nowMs = Date.now();
    pruneExpiredBuckets(nowMs);

    const keySuffix = options.keyResolver?.(c) ?? getClientAddress(c);
    const bucketKey = `${keyPrefix}:${keySuffix}`;
    const existing = buckets.get(bucketKey);
    const activeBucket = !existing || existing.resetAt <= nowMs
      ? { count: 0, resetAt: nowMs + windowMs }
      : existing;

    activeBucket.count += 1;
    buckets.set(bucketKey, activeBucket);

    const remaining = Math.max(0, maxRequests - activeBucket.count);
    const resetInSeconds = Math.max(0, Math.ceil((activeBucket.resetAt - nowMs) / 1000));

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(activeBucket.resetAt / 1000)));

    if (activeBucket.count > maxRequests) {
      c.header("Retry-After", String(resetInSeconds));
      const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
      const body: StandardErrorResponse = {
        error_code: "RATE_LIMITED",
        message: "Too many requests",
        request_id: requestId,
        details: {
          retry_after_seconds: resetInSeconds,
        },
      };
      c.res = c.json(body, ERROR_STATUS.RATE_LIMITED as 429);
      return;
    }

    await next();
  };
}

export const rateLimitMiddleware = createRateLimitMiddleware();
