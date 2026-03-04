import type { StandardErrorResponse } from "@guild/shared";
import { nanoid } from "nanoid";

type JsonValue = Record<string, unknown>;

const etagCache = new Map<string, string>();

type ApiRequestErrorOptions = {
  status: number;
  errorCode?: string;
  requestId?: string;
  details?: unknown;
};

export class ApiRequestError extends Error {
  status: number;
  errorCode?: string;
  requestId?: string;
  details?: unknown;

  constructor(message: string, options: ApiRequestErrorOptions) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.errorCode = options.errorCode;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

function sanitizeErrorMessage(message: string): string {
  if (/D1_ERROR|SQLITE_ERROR|no such table|no such column/i.test(message)) {
    return "Service temporarily unavailable. Please try again later.";
  }
  return message;
}

export async function apiRequest<TResponse>(
  input: string,
  init: RequestInit & { bodyJson?: JsonValue; ifMatch?: string } = {},
): Promise<TResponse> {
  const headers = new Headers(init.headers);
  headers.set("X-Request-Id", nanoid());

  const etag = etagCache.get(input);
  const method = (init.method ?? "GET").toUpperCase();
  if (etag && method === "GET") {
    headers.set("If-None-Match", etag);
  }
  if (init.ifMatch) {
    headers.set("If-Match", init.ifMatch);
  }

  if (init.bodyJson) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      body: init.bodyJson ? JSON.stringify(init.bodyJson) : init.body,
      headers,
    });
  } catch {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-network", {
          detail: {
            message: "Unable to reach server. Check your network and retry.",
          },
        }),
      );
    }
    throw new ApiRequestError("Network request failed", {
      status: 0,
    });
  }

  const responseEtag = response.headers.get("ETag");
  if (responseEtag) {
    etagCache.set(input, responseEtag);
  }

  if (!response.ok) {
    let errorPayload: StandardErrorResponse | null = null;
    try {
      errorPayload = (await response.json()) as StandardErrorResponse;
    } catch {
      errorPayload = null;
    }

    const requestPath = typeof input === "string" ? input : "";
    const isAuthLoginRequest =
      requestPath.includes("/api/auth/login") || requestPath.includes("/api/auth/register");

    if (response.status === 401 && typeof window !== "undefined" && !isAuthLoginRequest) {
      window.dispatchEvent(
        new CustomEvent("guild-api-unauthorized", {
          detail: {
            message: errorPayload?.message ?? "Session expired. Please log in again.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
            returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          },
        }),
      );
    }

    if (response.status === 403 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-forbidden", {
          detail: {
            message: errorPayload?.message ?? "You do not have permission for this action.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    if (response.status === 409 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-conflict", {
          detail: {
            message: errorPayload?.message ?? "Conflict detected. Please refresh and retry.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    throw new ApiRequestError(
      sanitizeErrorMessage(errorPayload?.message ?? `Request failed: ${response.status}`),
      {
      status: response.status,
      errorCode: errorPayload?.error_code,
      requestId: errorPayload?.request_id,
      details: errorPayload?.details,
      },
    );
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  return (await response.json()) as TResponse;
}

export async function apiDownload(
  input: string,
  init: RequestInit = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const headers = new Headers(init.headers);
  headers.set("X-Request-Id", nanoid());

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      method: init.method ?? "GET",
      credentials: "include",
      headers,
    });
  } catch {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-network", {
          detail: {
            message: "Unable to reach server. Check your network and retry.",
          },
        }),
      );
    }
    throw new ApiRequestError("Network request failed", {
      status: 0,
    });
  }

  if (!response.ok) {
    let errorPayload: StandardErrorResponse | null = null;
    try {
      errorPayload = (await response.json()) as StandardErrorResponse;
    } catch {
      errorPayload = null;
    }

    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-unauthorized", {
          detail: {
            message: errorPayload?.message ?? "Session expired. Please log in again.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
            returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          },
        }),
      );
    }

    if (response.status === 403 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-forbidden", {
          detail: {
            message: errorPayload?.message ?? "You do not have permission for this action.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    if (response.status === 409 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("guild-api-conflict", {
          detail: {
            message: errorPayload?.message ?? "Conflict detected. Please refresh and retry.",
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    throw new ApiRequestError(
      sanitizeErrorMessage(errorPayload?.message ?? `Request failed: ${response.status}`),
      {
        status: response.status,
        errorCode: errorPayload?.error_code,
        requestId: errorPayload?.request_id,
        details: errorPayload?.details,
      },
    );
  }

  const blob = await response.blob();
  return { blob, headers: response.headers };
}
