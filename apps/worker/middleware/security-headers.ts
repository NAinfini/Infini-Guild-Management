import type { Context, Next } from "hono";
import { EMBED_FRAME_SOURCES } from "@guild/shared/utils/video";

export const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";
export const REFERRER_POLICY_VALUE = "strict-origin-when-cross-origin";
export const X_CONTENT_TYPE_VALUE = "nosniff";
export const PERMISSIONS_POLICY_VALUE = "camera=(), microphone=(), geolocation=()";

function buildWebSocketSource(requestUrl: string | URL): string {
  const url = new URL(requestUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}`;
}

export function buildSpaHtmlCsp(requestUrl: string | URL): string {
  // The static splash uses inline CSS only, so script-src stays 'self'-only.
  // style-src keeps 'unsafe-inline': Mantine injects inline styles at runtime.
  const frameSrc = `frame-src ${EMBED_FRAME_SOURCES.join(" ")}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self' ${buildWebSocketSource(requestUrl)}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    frameSrc,
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
  await next();
  const connectSrc = `connect-src 'self' ${buildWebSocketSource(c.req.url)}`;
  const frameSrc = `frame-src ${EMBED_FRAME_SOURCES.join(" ")}`;
  c.header("X-Content-Type-Options", X_CONTENT_TYPE_VALUE);
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", HSTS_VALUE);
  c.header("Referrer-Policy", REFERRER_POLICY_VALUE);
  c.header("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; ${connectSrc}; font-src 'self'; object-src 'none'; ${frameSrc}; frame-ancestors 'none'`,
  );
}
