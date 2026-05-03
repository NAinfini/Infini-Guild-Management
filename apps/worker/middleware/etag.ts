import type { Context, Next } from "hono";

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
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
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

  const payloadBuffer = await currentResponse.clone().arrayBuffer();
  const etag = `"${await sha256Hex(payloadBuffer)}"`;
  const requestEtags = parseIfNoneMatch(c.req.header("If-None-Match"));

  if (requestEtags.includes("*") || requestEtags.includes(etag)) {
    const headers = new Headers(currentResponse.headers);
    headers.set("ETag", etag);
    c.res = new Response(null, { status: 304, headers });
    return;
  }

  if (currentResponse.status === 200 && c.req.method === "GET") {
    currentResponse.headers.set("Cache-Control", "private, no-cache, must-revalidate");
  }

  c.header("ETag", etag);
}
