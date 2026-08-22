import { EMBED_FRAME_SOURCES } from "./video";

/*
 * 门户静态响应的完整安全头。两个运行时的静态适配器共用这一份，
 * frame-src 因此与 toEmbedVideoUrl 实际产出的嵌入播放器域始终同源。
 */
export function applyStaticSecurityHeaders(headers: Headers, requestUrl: string): void {
  const url = new URL(requestUrl);
  const socketSource = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    `connect-src 'self' ${socketSource}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    `frame-src ${EMBED_FRAME_SOURCES.join(" ")}`,
    "frame-ancestors 'none'",
  ].join("; "));
}
