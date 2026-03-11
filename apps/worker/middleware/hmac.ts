import { ERROR_STATUS, type ErrorCode, type StandardErrorResponse } from "@guild/shared";
import type { Context, Next } from "hono";
import type { Bindings } from "../index";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const textEncoder = new TextEncoder();

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  const hashA = new Uint8Array(await crypto.subtle.digest("SHA-256", aBytes));
  const hashB = new Uint8Array(await crypto.subtle.digest("SHA-256", bBytes));
  let diff = 0;
  for (let index = 0; index < hashA.length; index += 1) {
    diff |= hashA[index] ^ hashB[index];
  }
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
}

function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503);
}

export async function hmacMiddleware(c: Context, next: Next): Promise<void> {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const env = c.env as Bindings;
  const secret = env.BOT_SHARED_SECRET;
  if (!secret) {
    c.res = buildError(c, "SERVER_ERROR", "BOT_SHARED_SECRET is not configured");
    return;
  }

  const timestampHeader = c.req.header("X-Timestamp");
  const signatureHeader = c.req.header("X-Signature");
  if (!timestampHeader || !signatureHeader) {
    c.res = buildError(c, "UNAUTHORIZED", "Missing HMAC authentication headers");
    return;
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    c.res = buildError(c, "UNAUTHORIZED", "Invalid X-Timestamp header");
    return;
  }

  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    c.res = buildError(c, "UNAUTHORIZED", "Expired HMAC timestamp");
    return;
  }

  const body = await c.req.raw.clone().text();
  const expectedSignature = await hmacSha256Hex(`${timestampHeader}.${body}`, secret);
  const normalizedProvided = signatureHeader.trim().toLowerCase();

  if (!(await timingSafeEqual(normalizedProvided, expectedSignature))) {
    c.res = buildError(c, "UNAUTHORIZED", "Invalid HMAC signature");
    return;
  }

  await next();
}
