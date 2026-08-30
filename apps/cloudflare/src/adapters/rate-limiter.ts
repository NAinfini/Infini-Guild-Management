import type { RateLimitDecision, RateLimiter } from "@guild/kernel";
import type { AuthLoginRateLimitScope } from "../runtime/auth-rate-limit-durable-object.js";

type AuthRateLimitTarget = Pick<DurableObjectNamespace, "get" | "idFromName">;

const AUTH_LOGIN_RATE_LIMIT_PREFIXES: Readonly<Record<AuthLoginRateLimitScope, string>> = Object.freeze({
  ip: "auth:login:ip:",
  login_pair: "auth:login:name:",
});

function normalizeKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new TypeError("Rate-limit key is required");
  return normalized;
}

function parseDecision(value: unknown): RateLimitDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid authentication rate-limit response");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.allowed !== "boolean") throw new TypeError("Invalid authentication rate-limit response");
  if (record.allowed) return { allowed: true };
  if (
    typeof record.retryAfterSeconds !== "number"
    || !Number.isSafeInteger(record.retryAfterSeconds)
    || record.retryAfterSeconds < 1
  ) {
    throw new TypeError("Invalid authentication rate-limit response");
  }
  return { allowed: false, retryAfterSeconds: record.retryAfterSeconds };
}

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
    const normalized = normalizeKey(key);
    const outcome = await this.binding.limit({ key: normalized });
    return outcome.success
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: this.retryAfterSeconds };
  }
}

/**
 * Cloudflare Rate Limiting remains the low-latency first layer. This second
 * Durable Object layer gives each login bucket a serialized, exact counter
 * before password work or account lookup can begin.
 */
export class CloudflareConsistentAuthRateLimiter implements RateLimiter {
  constructor(
    private readonly firstLayer: RateLimiter,
    private readonly target: AuthRateLimitTarget,
    private readonly scope: AuthLoginRateLimitScope,
  ) {}

  async consume(key: string): Promise<RateLimitDecision> {
    const normalized = normalizeKey(key);
    const firstDecision = await this.firstLayer.consume(normalized);
    if (!firstDecision.allowed) return firstDecision;
    if (!normalized.startsWith(AUTH_LOGIN_RATE_LIMIT_PREFIXES[this.scope])) return firstDecision;

    const id = this.target.idFromName(`auth-login-rate-limit:${this.scope}:${normalized}`);
    const response = await this.target.get(id).fetch("https://auth-rate-limit.internal/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: this.scope }),
    });
    if (!response.ok) throw new TypeError("Authentication rate-limit Durable Object is unavailable");
    return parseDecision(await response.json());
  }
}
