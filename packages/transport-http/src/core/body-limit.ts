import { AppError } from "@guild/kernel";
import { LIMITS } from "@guild/shared";
import type { MiddlewareHandler } from "hono";
import type { HttpEnv } from "./http-env.js";

const bufferedRequestBodies = new WeakMap<Request, Uint8Array<ArrayBuffer>>();

export class HttpPayloadTooLargeError extends Error {
  override readonly name = "HttpPayloadTooLargeError";

  constructor(readonly limit: number) {
    super(`Request body exceeds the ${limit} byte limit`);
  }
}

export function createRequestBodyLimitMiddleware(): MiddlewareHandler<HttpEnv> {
  return async (context, next) => {
    const request = context.req.raw;
    const multipart = request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data") === true;
    const limit = multipart ? LIMITS.requestBody.upload : LIMITS.requestBody.ordinary;
    if (multipart) assertRequestBodyLength(request, limit);
    else await readBodyBytes(request, limit);
    return next();
  };
}

export const createBodyLimitMiddleware = createRequestBodyLimitMiddleware;

export async function readBodyBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = assertRequestBodyLength(request, limit);
  const buffered = bufferedRequestBodies.get(request);
  if (buffered) {
    if (buffered.byteLength > limit) throw new HttpPayloadTooLargeError(limit);
    return buffered;
  }
  if (!request.body) {
    if (contentLength !== null && contentLength !== 0) throw invalidContentLength();
    const empty = new Uint8Array(new ArrayBuffer(0));
    bufferedRequestBodies.set(request, empty);
    return empty;
  }

  const reader = request.body.getReader();
  if (contentLength !== null) {
    const bytes = new Uint8Array(new ArrayBuffer(contentLength));
    let offset = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (offset + next.value.byteLength > contentLength) {
          await reader.cancel().catch(() => undefined);
          throw invalidContentLength();
        }
        bytes.set(next.value, offset);
        offset += next.value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    if (offset !== contentLength) throw invalidContentLength();
    bufferedRequestBodies.set(request, bytes);
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new HttpPayloadTooLargeError(limit);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  bufferedRequestBodies.set(request, bytes);
  return bytes;
}

export function assertRequestBodyLength(request: Request, limit: number): number | null {
  return parseContentLength(request.headers.get("Content-Length"), limit);
}

function parseContentLength(value: string | null, limit: number): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw invalidContentLength();
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw invalidContentLength();
  }
  if (length > limit) throw new HttpPayloadTooLargeError(limit);
  return length;
}

function invalidContentLength(): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message: "Invalid Content-Length header" });
}
