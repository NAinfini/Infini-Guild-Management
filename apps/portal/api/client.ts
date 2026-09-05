import type { StandardErrorResponse } from "@guild/shared";
import i18n from "i18next";
import { nanoid } from "nanoid";

type JsonValue = Record<string, unknown>;
type ApiRequestInit = RequestInit & {
  bodyJson?: JsonValue;
  ifMatch?: string;
  signal?: AbortSignal | null;
};
type CachedJsonResponse = {
  etag: string;
  data: unknown;
};

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
const JSON_CACHE_MAX = 100;
const jsonResponseCache = new Map<string, CachedJsonResponse>();
let sessionCacheRevision = 0;

export function resetApiSessionCache(): void {
  sessionCacheRevision += 1;
  jsonResponseCache.clear();
}

function fetchWithTimeout(url: string, init: RequestInit, externalSignal?: AbortSignal, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const combinedSignal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  return fetch(url, { ...init, signal: combinedSignal }).finally(() => clearTimeout(id));
}

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

function handleFetchError(err: unknown): never {
  const message = err instanceof DOMException && err.name === "AbortError"
    ? tCommon("errors.requestTimeout", "Request timed out. Please try again.")
    : tCommon("errors.connectionIssue", "Unable to reach server. Check your network and retry.");
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("guild-api-network", {
        detail: {
          message,
        },
      }),
    );
  }
  throw new ApiRequestError(message, {
    status: 0,
  });
}

async function handleErrorResponse(response: Response): Promise<never> {
  let errorPayload: StandardErrorResponse | null = null;
  try {
    errorPayload = (await response.json()) as StandardErrorResponse;
  } catch {
    errorPayload = null;
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

  throw new ApiRequestError(resolveErrorMessage(errorPayload?.message, response.status), {
    status: response.status,
    errorCode: errorPayload?.error_code,
    requestId: errorPayload?.request_id,
    details: errorPayload?.details,
  });
}

export async function apiRequest<TResponse>(
  input: string,
  init: ApiRequestInit = {},
): Promise<TResponse> {
  const url = input;
  const cacheRevision = sessionCacheRevision;
  const {
    bodyJson,
    ifMatch,
    signal,
    ...requestInit
  } = init;
  const headers = new Headers(requestInit.headers);

  const method = (requestInit.method ?? "GET").toUpperCase();
  const cacheKey = method === "GET" && !requestInit.body && !bodyJson ? url : null;
  const cachedResponse = cacheKey ? jsonResponseCache.get(cacheKey) : undefined;
  if (cachedResponse) {
    headers.set("If-None-Match", cachedResponse.etag);
  }

  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("X-Request-Id", nanoid());
  }

  if (ifMatch) {
    headers.set("If-Match", ifMatch);
  }

  if (bodyJson) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...requestInit,
      credentials: "include",
      body: bodyJson ? JSON.stringify(bodyJson) : requestInit.body,
      headers,
    }, signal ?? undefined);
  } catch (err) {
    signal?.throwIfAborted();
    handleFetchError(err);
  }

  if (response.status === 304) {
    if (cacheKey && cachedResponse) {
      // A response started under an earlier identity must not repopulate this cache.
      if (cacheRevision === sessionCacheRevision) {
        jsonResponseCache.delete(cacheKey);
        jsonResponseCache.set(cacheKey, cachedResponse);
      }
      return cachedResponse.data as TResponse;
    }
    throw new ApiRequestError("Cached response unavailable", { status: 304 });
  }

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  if (method !== "GET" && cacheRevision === sessionCacheRevision) {
    const basePath = url.split("?")[0]!.split("/").slice(0, 4).join("/");
    for (const key of jsonResponseCache.keys()) {
      if (key.startsWith(basePath)) jsonResponseCache.delete(key);
    }
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  let data: TResponse;
  try {
    data = (await response.json()) as TResponse;
  } catch {
    throw new ApiRequestError("Invalid response from server", {
      status: response.status,
    });
  }

  const etag = response.headers.get("ETag");
  if (cacheKey && etag && cacheRevision === sessionCacheRevision) {
    if (jsonResponseCache.size >= JSON_CACHE_MAX) {
      const oldest = jsonResponseCache.keys().next().value;
      if (oldest !== undefined) jsonResponseCache.delete(oldest);
    }
    jsonResponseCache.set(cacheKey, { etag, data });
  }

  return data;
}

export async function apiDownload(
  input: string,
  init: RequestInit = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const url = input;
  const { signal, ...requestInit } = init;
  const headers = new Headers(init.headers);
  headers.set("X-Request-Id", nanoid());

  const method = (init.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...requestInit,
      method: init.method ?? "GET",
      credentials: "include",
      headers,
    }, signal ?? undefined);
  } catch (err) {
    signal?.throwIfAborted();
    handleFetchError(err);
  }

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  const blob = await response.blob();
  return { blob, headers: response.headers };
}
