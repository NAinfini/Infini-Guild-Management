import type { Context, Next } from "hono";

const MAX_ETAG_BYTES = 64 * 1024;
const SKIP_PATH_PREFIXES = [
  "/api/users",
  "/api/gallery",
  "/api/admin/audit",
  "/api/search",
  "/api/dashboard",
];
const SKIP_PATH_SUFFIXES = [
  "/batch",
  "/batch-details",
  "/export",
];

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return toHex(digest);
}

function parseIfNoneMatch(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function shouldApplyEtag(path: string, contentLength: string | null): boolean {
  if (SKIP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (SKIP_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix))) return false;
  const parsedLength = Number.parseInt(contentLength ?? "", 10);
  return !Number.isFinite(parsedLength) || parsedLength <= MAX_ETAG_BYTES;
}

export async function etagMiddleware(c: Context, next: Next): Promise<void> {
  if (c.req.method !== "GET") {
    await next();
    return;
  }

  await next();

  const currentResponse = c.res;
  if (currentResponse.status < 200 || currentResponse.status >= 300) {
    return;
  }

  const contentType = currentResponse.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return;
  }
  if (!shouldApplyEtag(c.req.path, currentResponse.headers.get("Content-Length"))) {
    currentResponse.headers.set("Cache-Control", "private, no-cache, must-revalidate");
    return;
  }

  const payloadBuffer = await currentResponse.clone().arrayBuffer();
  if (payloadBuffer.byteLength > MAX_ETAG_BYTES) {
    currentResponse.headers.set("Cache-Control", "private, no-cache, must-revalidate");
    return;
  }

  const etag = `"${await sha256Hex(payloadBuffer)}"`;
  const requestEtags = parseIfNoneMatch(c.req.header("If-None-Match"));

  if (requestEtags.includes("*") || requestEtags.includes(etag)) {
    const headers = new Headers(currentResponse.headers);
    headers.set("ETag", etag);
    c.res = new Response(null, { status: 304, headers });
    return;
  }

  currentResponse.headers.set("Cache-Control", "private, no-cache, must-revalidate");
  c.header("ETag", etag);
}
