import { isAppError, type StandardErrorResponse } from "@guild/kernel";
import type { ErrorHandler } from "hono";
import { HttpPayloadTooLargeError } from "./body-limit.js";
import { HttpRangeError } from "./http-range-error.js";
import type { HttpEnv } from "./http-env.js";

export type HttpErrorHandlerOptions = Readonly<{
  onUnexpected?: (error: Error, requestId: string, request: Readonly<{
    path: string;
    method: string;
    occurredAt: string;
  }>) => void | Promise<void>;
}>;

export function createHttpErrorHandler(options: HttpErrorHandlerOptions = {}): ErrorHandler<HttpEnv> {
  return async (error, context) => {
    const injected = context.get("requestContext");
    const requestId = injected?.requestId ?? context.req.header("X-Request-Id")?.trim() ?? crypto.randomUUID();
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    });

    if (isAppError(error)) {
      const retryAfter = error.status === 429 ? retryAfterSeconds(error.details) : null;
      if (retryAfter !== null) headers.set("Retry-After", String(retryAfter));
      return new Response(JSON.stringify(error.toResponseBody(requestId)), {
        status: error.status,
        headers,
      });
    }

    if (error instanceof HttpRangeError || error instanceof HttpPayloadTooLargeError) {
      const body: StandardErrorResponse = {
        error_code: "VALIDATION_ERROR",
        message: error.message,
        request_id: requestId,
      };
      if (error instanceof HttpRangeError && error.total !== undefined) {
        headers.set("Content-Range", `bytes */${error.total}`);
      }
      return new Response(JSON.stringify(body), {
        status: error instanceof HttpRangeError ? 416 : 413,
        headers,
      });
    }

    try {
      await options.onUnexpected?.(error, requestId, {
        path: context.req.path,
        method: context.req.method,
        occurredAt: injected?.now ?? new Date().toISOString(),
      });
    } catch {
      // Error reporting must never replace the original transport response.
    }
    const body: StandardErrorResponse = {
      error_code: "SERVER_ERROR",
      message: "An unexpected server error occurred",
      request_id: requestId,
    };
    return new Response(JSON.stringify(body), { status: 500, headers });
  };
}

function retryAfterSeconds(details: unknown): number | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { retry_after_seconds?: unknown }).retry_after_seconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}
