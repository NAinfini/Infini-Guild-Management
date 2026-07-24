import type { ErrorCode, StandardErrorResponse } from "@guild/shared";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { createLogger } from "../utils/logger";
import { writeErrorLog } from "../services/ErrorLogService";
import type { Bindings } from "../index";

type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  500: "SERVER_ERROR",
  503: "UPSTREAM_ERROR",
};

function toErrorCode(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? "SERVER_ERROR";
}

function toStatusCode(status: number): ErrorStatusCode {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 429 || status === 503) {
    return status;
  }
  return 500;
}

function buildErrorBody(c: Context, status: number, message: string, details?: unknown): StandardErrorResponse {
  const requestId = (c.get("requestId") as string | undefined) ?? crypto.randomUUID();
  return {
    error_code: toErrorCode(status),
    message,
    request_id: requestId,
    ...(details !== undefined ? { details } : {}),
  };
}

function persistError(c: Context, message: string, stack?: string): void {
  try {
    const env = c.env as Bindings;
    c.executionCtx.waitUntil(
      writeErrorLog(env.DB, {
        source: "request",
        message,
        requestPath: c.req.path,
        requestMethod: c.req.method,
        requestId: c.get("requestId") as string | undefined,
        stack,
      }),
    );
  } catch {
    // executionCtx may be unavailable in tests — silently skip
  }
}

export function handleAppError(error: unknown, c: Context): Response {
  const log = createLogger(c.get("requestId") as string | undefined);

  if (error instanceof HTTPException) {
    // Guards and parsers throw HTTPException carrying a fully-formed standard
    // error envelope (see throwError in routes/_shared.ts) — return it as-is.
    if (error.res) {
      if (error.status >= 500) {
        persistError(c, error.message || "HTTPException 5xx", error.stack);
      }
      return error.res;
    }
    const status = toStatusCode(error.status);
    const message = status >= 500 ? "Internal server error" : error.message || "Request failed";
    if (status >= 500) {
      persistError(c, error.message || "HTTPException 5xx", error.stack);
    }
    return c.json(buildErrorBody(c, status, message), status);
  }

  if (error instanceof Error) {
    log.error("Unhandled error", { method: c.req.method, path: c.req.path, error: error.message, stack: error.stack });
    persistError(c, error.message, error.stack);
    return c.json(buildErrorBody(c, 500, "Internal server error"), 500);
  }

  log.error("Non-Error thrown", { method: c.req.method, path: c.req.path, error: String(error) });
  persistError(c, String(error));
  return c.json(buildErrorBody(c, 500, "Internal server error"), 500);
}