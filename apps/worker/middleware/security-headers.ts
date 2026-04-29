import type { Context, Next } from "hono";

export async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
  await next();
  const host = c.req.header("Host") ?? new URL(c.req.url).host;
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' wss://${host}; font-src 'self'; object-src 'none'; frame-ancestors 'none'`,
  );
}
