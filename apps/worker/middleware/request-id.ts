import type { Context, Next } from "hono";

export async function requestIdMiddleware(c: Context, next: Next): Promise<void> {
  c.set("requestId", crypto.randomUUID());
  await next();
}
