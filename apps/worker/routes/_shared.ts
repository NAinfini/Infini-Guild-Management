import { ERROR_STATUS, type ErrorCode, type StandardErrorResponse } from "@guild/shared";
import type { Context } from "hono";
import type { ZodTypeAny } from "zod";
import { getRequestUser } from "../middleware/rbac";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

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

export function handleResult(
  c: Context,
  result: { ok: true; data: unknown } | { ok: false; code: ErrorCode; message: string; details?: unknown },
  status?: number,
): Response {
  if (!result.ok) return buildError(c, result.code, result.message, result.details);
  return c.json(result.data, status as never);
}

export function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function parseJsonBody(c: Context, schema?: ZodTypeAny): Promise<unknown | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return buildError(c, "VALIDATION_ERROR", "Invalid JSON body");
  }
  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return buildError(c, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
    return parsed.data;
  }
  return body;
}

export async function requireSessionUser(c: Context) {
  const user = await getRequestUser(c);
  return user ?? buildError(c, "UNAUTHORIZED", "Authentication required");
}
