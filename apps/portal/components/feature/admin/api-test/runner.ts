import { type EndpointDef, type EndpointResult, type PreparedEndpointRequest, isRecord } from "./types";

export const API_TEST_GAP_GET_MS = 90;
export const API_TEST_GAP_MUTATION_MS = 900;

export function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort);
  });
}

export function readRetryAfterSeconds(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }
  const details = isRecord(payload.details) ? payload.details : null;
  const retryAfter = details?.retry_after_seconds;
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter < 0) {
    return null;
  }
  return Math.ceil(retryAfter);
}

export function methodColor(method: string): string {
  switch (method) {
    case "GET":
      return "blue";
    case "POST":
      return "green";
    case "PATCH":
      return "yellow";
    case "DELETE":
      return "red";
    default:
      return "gray";
  }
}

export function statusColor(status: number | null): string {
  if (status === null) return "gray";
  if (status >= 200 && status < 300) return "green";
  if (status >= 400 && status < 500) return "yellow";
  return "red";
}

export function truncateJson(json: string, maxLen = 2000): string {
  if (json.length <= maxLen) return json;
  return `${json.slice(0, maxLen)}\n... (truncated)`;
}

export async function runEndpointTest(
  endpoint: EndpointDef,
  prepared: PreparedEndpointRequest,
  signal?: AbortSignal,
): Promise<EndpointResult> {
  const ranAt = new Date().toISOString();
  if (prepared.skipReason) {
    return {
      status: null,
      latencyMs: 0,
      body: prepared.skipReason,
      error: prepared.optionalSkip ? null : "Skipped",
      ranAt,
      parsedJson: null,
      skipped: true,
    };
  }

  const started = performance.now();
  try {
    const mergedHeaders: Record<string, string> = { ...prepared.headers };
    if (endpoint.method === "POST" || endpoint.method === "PATCH" || endpoint.method === "DELETE") {
      mergedHeaders["X-Requested-With"] = "XMLHttpRequest";
    }

    const response = await fetch(prepared.path, {
      method: endpoint.method,
      credentials: prepared.credentials ?? "include",
      signal,
      headers: mergedHeaders,
      body: prepared.body,
    });
    const latencyMs = Math.round(performance.now() - started);
    let body: string;
    let parsedJson: unknown | null = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const raw = await response.text();
      if (raw) {
        const json = JSON.parse(raw) as unknown;
        body = JSON.stringify(json, null, 2);
        parsedJson = json;
      } else {
        body = "";
      }
    } else {
      body = await response.text();
    }
    return {
      status: response.status,
      latencyMs,
      body: truncateJson(body),
      error: response.ok ? null : `${response.status} ${response.statusText}`,
      ranAt,
      parsedJson,
    };
  } catch (err) {
    if (signal?.aborted) {
      return { status: null, latencyMs: 0, body: "", error: "Aborted", ranAt, parsedJson: null };
    }
    const latencyMs = Math.round(performance.now() - started);
    return {
      status: null,
      latencyMs,
      body: "",
      error: err instanceof Error ? err.message : "Unknown error",
      ranAt,
      parsedJson: null,
    };
  }
}

let logIdCounter = 0;
export function nextLogId(): string {
  logIdCounter += 1;
  return `log-${Date.now()}-${logIdCounter}`;
}
