import type { Context, Next } from "hono";
import { EMBED_FRAME_SOURCES } from "@guild/shared/utils/video";

export async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
  await next();
  const selfHost = new URL(c.req.url).host;
  const connectSrc = `connect-src 'self' wss://${selfHost}`;
  const frameSrc = `frame-src ${EMBED_FRAME_SOURCES.join(" ")}`;
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; ${connectSrc}; font-src 'self'; object-src 'none'; ${frameSrc}; frame-ancestors 'none'`,
  );
}
