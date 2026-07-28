import { ERROR_STATUS, type StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";

type RateLimitOptions = {
  maxRequests?: number;
  windowMs?: number;
  keyPrefix?: string;
  keyResolver?: (c: Context) => string;
  deferWrite?: boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Cache API rate limiter — cross-isolate within the same Cloudflare colo.
 *
 * Uses the Cache API as a shared counter store. Unlike in-memory Maps,
 * the Cache API is shared across all Worker isolates in the same colo,
 * providing effective rate limiting without additional paid features.
 *
 * Note: Cache API is eventually consistent across colos, so a globally
 * distributed attacker could still exceed limits. For absolute guarantees,
 * layer Cloudflare's native rate limiting rules on top.
 */
const CACHE_NAMESPACE = "rate-limit-v1";

function getClientAddress(c: Context): string {
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp) return cfIp;

  const forwardedFor = c.req.header("X-Forwarded-For");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

function buildCacheKey(prefix: string, suffix: string, windowId: number): string {
  return `https://${CACHE_NAMESPACE}/${prefix}/${suffix}/${windowId}`;
}

async function getCachedBucket(cacheKey: string): Promise<Bucket | null> {
  const cache = await caches.open(CACHE_NAMESPACE);
  const cached = await cache.match(new Request(cacheKey));
  if (!cached) return null;
  try {
    return (await cached.json()) as Bucket;
  } catch {
    return null;
  }
}

async function setCachedBucket(cacheKey: string, bucket: Bucket, ttlSeconds: number): Promise<void> {
  const cache = await caches.open(CACHE_NAMESPACE);
  const response = new Response(JSON.stringify(bucket), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `s-maxage=${ttlSeconds}`,
    },
  });
  await cache.put(new Request(cacheKey), response);
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const keyPrefix = options.keyPrefix ?? "global";
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async function rateLimitMiddleware(c: Context, next: Next): Promise<void> {
    const nowMs = Date.now();
    const windowId = Math.floor(nowMs / windowMs);
    const keySuffix = options.keyResolver?.(c) ?? getClientAddress(c);
    const cacheKey = buildCacheKey(keyPrefix, keySuffix, windowId);

    const existing = await getCachedBucket(cacheKey);
    const activeBucket: Bucket = existing ?? { count: 0, resetAt: (windowId + 1) * windowMs };

    activeBucket.count += 1;

    // Await the write to ensure sequential requests within the same isolate
    // see accurate counts. Cross-isolate races remain possible but acceptable
    // for a guild-scale app (50-200 members). For absolute guarantees, layer
    // Cloudflare's native rate limiting rules on top.
    const ttl = Math.max(1, windowSeconds - Math.floor((nowMs % windowMs) / 1000));
    const writeBucket = setCachedBucket(cacheKey, activeBucket, ttl);
    if (options.deferWrite) {
      try {
        c.executionCtx.waitUntil(writeBucket);
      } catch {
        await writeBucket;
      }
    } else {
      await writeBucket;
    }

    const remaining = Math.max(0, maxRequests - activeBucket.count);
    const resetInSeconds = Math.max(0, Math.ceil((activeBucket.resetAt - nowMs) / 1000));

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(activeBucket.resetAt / 1000)));

    // `count` was already incremented for this request, so the comparison is
    // strictly greater-than: `>=` would have rejected the maxRequests-th request
    // and made the effective allowance maxRequests - 1.
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
