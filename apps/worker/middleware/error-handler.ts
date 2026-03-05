import type { ErrorCode, StandardErrorResponse } from "@guild/shared";
import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";

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

export function handleAppError(error: unknown, c: Context): Response {
  if (error instanceof HTTPException) {
    const status = toStatusCode(error.status);
    const message = error.message || "Request failed";
    return c.json(buildErrorBody(c, status, message), status);
  }

  if (error instanceof Error) {
    console.error(`[handleAppError] ${c.req.method} ${c.req.path}:`, error.message, error.stack);
    return c.json(buildErrorBody(c, 500, error.message || "Internal server error"), 500);
  }

  console.error(`[handleAppError] ${c.req.method} ${c.req.path}: non-Error thrown:`, error);
  return c.json(buildErrorBody(c, 500, "Internal server error"), 500);
}

export async function errorHandlerMiddleware(c: Context, next: Next): Promise<void> {
  try {
    await next();
  } catch (error) {
    c.res = handleAppError(error, c);
  }
}
