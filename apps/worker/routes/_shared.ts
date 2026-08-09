import { ERROR_STATUS, LIMITS, type ErrorCode, type StandardErrorResponse } from "@guild/shared";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodTypeAny } from "zod";
import type { Bindings } from "../index";
import { getRequestUser } from "../middleware/rbac";
import type { SessionUser } from "../services/auth";
export { parsePage } from "../utils/pagination";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const MEDIA_CACHE_CONTROL = `private, max-age=${LIMITS.cache.mediaMaxAgeSeconds}`;

export function getDb(c: Context) {
  return drizzle((c.env as Bindings).DB);
}

export function collectFiles(form: FormData): File[] {
  const files: File[] = [];
  const single = form.get("file");
  if (single instanceof File) files.push(single);
  for (const item of form.getAll("files")) {
    if (item instanceof File) files.push(item);
  }
  return files;
}

/*
 * R2Range is a union in the type definitions, but the runtime hands back one
 * object carrying all three fields with the unused ones set to undefined, so
 * `"suffix" in range` matches every range and cannot discriminate it. Decide by
 * value instead. A suffix range counts backwards from the end and, per RFC 9110,
 * degenerates to the whole representation once it reaches past the start;
 * otherwise the window opens at offset and runs for length, each of which is
 * absent when the request left that side open.
 */
function resolveServedRange(range: R2Range, size: number): { offset: number; length: number } {
  const { offset, length, suffix } = range as { offset?: number; length?: number; suffix?: number };
  if (typeof suffix === "number") {
    const served = Math.min(suffix, size);
    return { offset: size - served, length: served };
  }
  const start = offset ?? 0;
  return { offset: start, length: length ?? size - start };
}

export async function serveR2Object(
  c: Context,
  key: string,
  notFoundMessage: string,
  expectedContentType?: string,
): Promise<Response> {
  const bucket = (c.env as Bindings).MEDIA;
  const requestHeaders = c.req.raw.headers;
  const wantsRange = requestHeaders.has("Range");

  // R2 evaluates If-None-Match / If-Modified-Since (onlyIf) and Range natively.
  let object = wantsRange
    ? await bucket.get(key, { onlyIf: requestHeaders, range: requestHeaders }).catch(() => null)
    : await bucket.get(key, { onlyIf: requestHeaders });
  // Tracks whether the get we ultimately answered from carried the Range —
  // local R2 (workerd) populates object.range even on full reads, so the
  // object alone cannot tell us whether a 206 is warranted.
  let servedRange = wantsRange;
  if (wantsRange && object === null) {
    // Unsatisfiable or malformed Range: a server may ignore Range and answer
    // with the full representation, which is also the cheapest recovery here.
    object = await bucket.get(key, { onlyIf: requestHeaders });
    servedRange = false;
  }
  if (!object) return buildError(c, "NOT_FOUND", notFoundMessage);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", expectedContentType ?? headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");

  // Precondition matched: R2 returns a bodyless R2Object — answer 304 so the
  // browser keeps its cached copy instead of re-downloading media. What decides
  // is the value, not the property: the runtime materializes absent fields as
  // undefined, so `in` alone would match either shape. The cast is only there
  // because TS cannot narrow across the R2Object class hierarchy.
  const body = "body" in object ? (object as R2ObjectBody).body : null;
  if (!body) {
    return new Response(null, { status: 304, headers });
  }

  const range = servedRange ? object.range : undefined;
  if (range) {
    const { offset, length } = resolveServedRange(range, object.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(body, { status: 206, headers });
  }

  return new Response(body, { headers });
}

export function buildError(c: Context, code: ErrorCode, message: string, details?: unknown): Response {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  const body: StandardErrorResponse = {
    error_code: code,
    message,
    request_id: requestId,
    ...(details ? { details } : {}),
  };
  return c.json(body, ERROR_STATUS[code] as ErrorStatusCode);
}

/**
 * Throws an HTTPException carrying a fully-formed standard error envelope.
 * The global error handler returns the carried Response as-is, so helpers can
 * fail a request from any depth without `instanceof Response` plumbing.
 */
export function throwError(c: Context, code: ErrorCode, message: string, details?: unknown): never {
  throw new HTTPException(ERROR_STATUS[code] as ErrorStatusCode, { res: buildError(c, code, message, details) });
}

export function handleResult(
  c: Context,
  result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown },
  status?: number,
): Response {
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, status as never);
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function parseJsonBody(c: Context, schema?: ZodTypeAny): Promise<unknown> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throwError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throwError(c, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    return parsed.data;
  }
  return body;
}

export async function safeFormData(c: Context): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throwError(c, "VALIDATION_ERROR", "Invalid or missing form data");
  }
}

export async function requireSessionUser(c: Context): Promise<SessionUser> {
  const user = await getRequestUser(c);
  if (!user) throwError(c, "UNAUTHORIZED", "Authentication required");
  return user;
}
