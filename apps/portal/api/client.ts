import type { StandardErrorResponse } from "@guild/shared";
import i18n from "i18next";
import { nanoid } from "nanoid";

type JsonValue = Record<string, unknown>;

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

const INTERNAL_SERVER_MESSAGE_PATTERN = /D1_ERROR|SQLITE_ERROR|no such table|no such column/i;

function tCommon(key: string, fallback: string): string {
  return i18n.t(`common:${key}`, { defaultValue: fallback });
}

function fallbackMessageForStatus(status: number): string {
  if (status === 401) {
    return tCommon("errors.sessionExpired", "Session expired. Please log in again.");
  }
  if (status === 403) {
    return tCommon("errors.forbidden", "Access denied.");
  }
  if (status === 409) {
    return tCommon("errors.conflict", "Conflict detected. Please refresh and retry.");
  }
  if (status === 503) {
    return tCommon("errors.serviceUnavailable", "Service temporarily unavailable. Please try again later.");
  }
  return tCommon("loadError", "Unable to load data. Please try again later.");
}

function resolveErrorMessage(message: string | null | undefined, status: number): string {
  if (message && !INTERNAL_SERVER_MESSAGE_PATTERN.test(message)) {
    return message;
  }
  return fallbackMessageForStatus(status);
}

export async function apiRequest<TResponse>(
  input: string,
  init: RequestInit & { bodyJson?: JsonValue; ifMatch?: string } = {},
): Promise<TResponse> {
  const headers = new Headers(init.headers);
  headers.set("X-Request-Id", nanoid());

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
            message: tCommon("errors.connectionIssue", "Unable to reach server. Check your network and retry."),
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

    const requestPath = typeof input === "string" ? input : "";
    const isAuthLoginRequest =
      requestPath.includes("/api/auth/login") || requestPath.includes("/api/auth/register");

    if (response.status === 401 && typeof window !== "undefined" && !isAuthLoginRequest) {
      window.dispatchEvent(
        new CustomEvent("guild-api-unauthorized", {
          detail: {
            message: resolveErrorMessage(errorPayload?.message, 401),
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
            message: resolveErrorMessage(errorPayload?.message, 403),
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
            message: resolveErrorMessage(errorPayload?.message, 409),
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    throw new ApiRequestError(resolveErrorMessage(errorPayload?.message, response.status), {
      status: response.status,
      errorCode: errorPayload?.error_code,
      requestId: errorPayload?.request_id,
      details: errorPayload?.details,
    });
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  const data = (await response.json()) as TResponse;

  return data;
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
            message: tCommon("errors.connectionIssue", "Unable to reach server. Check your network and retry."),
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
            message: resolveErrorMessage(errorPayload?.message, 401),
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
            message: resolveErrorMessage(errorPayload?.message, 403),
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
            message: resolveErrorMessage(errorPayload?.message, 409),
            requestId: errorPayload?.request_id,
            errorCode: errorPayload?.error_code,
          },
        }),
      );
    }

    throw new ApiRequestError(resolveErrorMessage(errorPayload?.message, response.status), {
      status: response.status,
      errorCode: errorPayload?.error_code,
      requestId: errorPayload?.request_id,
      details: errorPayload?.details,
    });
  }

  const blob = await response.blob();
  return { blob, headers: response.headers };
}
