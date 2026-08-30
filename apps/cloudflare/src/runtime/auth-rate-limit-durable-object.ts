import type { RateLimitDecision } from "@guild/kernel";
import { LIMITS } from "@guild/shared/config/limits";

const STORAGE_KEY = "window";
const MAX_CONSUME_BODY_BYTES = 128;

const AUTH_LOGIN_RATE_LIMIT_POLICIES = Object.freeze({
  ip: LIMITS.rateLimit.authIp,
  login_pair: LIMITS.rateLimit.auth,
});

export type AuthLoginRateLimitScope = keyof typeof AUTH_LOGIN_RATE_LIMIT_POLICIES;

type StoredWindow = Readonly<{
  scope: AuthLoginRateLimitScope;
  expiresAt: number;
  count: number;
}>;

function isScope(value: unknown): value is AuthLoginRateLimitScope {
  return value === "ip" || value === "login_pair";
}

function isStoredWindow(value: unknown): value is StoredWindow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isScope(record.scope)
    && typeof record.expiresAt === "number"
    && Number.isSafeInteger(record.expiresAt)
    && record.expiresAt > 0
    && typeof record.count === "number"
    && Number.isSafeInteger(record.count)
    && record.count >= 0;
}

function retryAfterSeconds(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
}

/**
 * One Durable Object identity represents one authentication throttle bucket.
 * The in-object tail makes read/increment/write atomic even when a test or a
 * future runtime allows fetch turns to overlap around storage awaits.
 */
export class AuthRateLimitDO {
  private consumeTail: Promise<void> = Promise.resolve();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/consume") {
      return new Response("Not found", { status: 404 });
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_CONSUME_BODY_BYTES) {
      return new Response("Invalid rate-limit request", { status: 400 });
    }
    let scope: AuthLoginRateLimitScope;
    try {
      const body = await request.json() as unknown;
      const value = typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).scope
        : undefined;
      if (!isScope(value)) throw new TypeError("Invalid rate-limit scope");
      scope = value;
    } catch {
      return new Response("Invalid rate-limit request", { status: 400 });
    }
    return Response.json(await this.consume(scope));
  }

  async alarm(): Promise<void> {
    const operation = this.consumeTail.then(() => this.clearExpiredWindow());
    this.consumeTail = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private async clearExpiredWindow(): Promise<void> {
    const stored = await this.state.storage.get<unknown>(STORAGE_KEY);
    if (!isStoredWindow(stored) || stored.expiresAt <= Date.now()) {
      await this.state.storage.delete(STORAGE_KEY);
      return;
    }
    await this.state.storage.setAlarm(stored.expiresAt);
  }

  private consume(scope: AuthLoginRateLimitScope): Promise<RateLimitDecision> {
    const operation = this.consumeTail.then(() => this.consumeWindow(scope));
    this.consumeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async consumeWindow(scope: AuthLoginRateLimitScope): Promise<RateLimitDecision> {
    const policy = AUTH_LOGIN_RATE_LIMIT_POLICIES[scope];
    const now = Date.now();
    const expiresAt = (Math.floor(now / policy.windowMs) + 1) * policy.windowMs;
    const stored = await this.state.storage.get<unknown>(STORAGE_KEY);
    if (stored !== undefined && !isStoredWindow(stored)) {
      throw new TypeError("Stored authentication rate-limit state is invalid");
    }
    if (stored && stored.scope !== scope) {
      throw new TypeError("Authentication rate-limit scope does not match the bucket");
    }
    const count = stored?.expiresAt === expiresAt ? stored.count : 0;
    if (count >= policy.maxRequests) {
      await this.state.storage.setAlarm(expiresAt);
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(expiresAt, now) };
    }
    await this.state.storage.put(STORAGE_KEY, { scope, expiresAt, count: count + 1 } satisfies StoredWindow);
    await this.state.storage.setAlarm(expiresAt);
    return { allowed: true };
  }
}
