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

export async function serveR2Object(c: Context, key: string, notFoundMessage: string): Promise<Response> {
  const object = await (c.env as Bindings).MEDIA.get(key);
  if (!object?.body) return buildError(c, "NOT_FOUND", notFoundMessage);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/octet-stream");
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL);
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
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
