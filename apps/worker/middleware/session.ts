import type { Context, Next } from "hono";
import { resolveSession } from "../services/auth";

export async function sessionMiddleware(c: Context, next: Next): Promise<void> {
  const resolved = await resolveSession(c);
  c.set("user", resolved?.user ?? null);
  await next();
}
