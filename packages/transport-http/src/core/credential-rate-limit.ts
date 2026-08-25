import { AppError, type RateLimiter } from "@guild/kernel";

export async function consumeCredentialRateLimit(
  rateLimiter: RateLimiter,
  userId: string,
  clientIdentifier: string,
): Promise<void> {
  for (const key of [
    `auth:credential:user:${encodeURIComponent(userId)}`,
    `auth:credential:source:${encodeURIComponent(clientIdentifier)}`,
  ]) {
    const decision = await rateLimiter.consume(key);
    if (!decision.allowed) {
      throw new AppError({
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many credential verification attempts",
        details: { retry_after_seconds: decision.retryAfterSeconds ?? 1 },
      });
    }
  }
}
