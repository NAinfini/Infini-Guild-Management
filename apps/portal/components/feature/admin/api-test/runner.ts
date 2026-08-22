import {
  SYSTEM_TEST_HEADER,
  SYSTEM_TEST_HEADER_VALUE,
  SYSTEM_TEST_RUN_ID_HEADER,
} from "@guild/shared/config/system-test";
import type { SystemTestSummary } from "@guild/shared/schemas/system-test";
import {
  type DebugLogEntry,
  type EndpointDef,
  type EndpointResult,
  type PreparedEndpointRequest,
  isRecord,
} from "./types";

export const API_TEST_GAP_GET_MS = 90;
export const API_TEST_GAP_MUTATION_MS = 900;
export const SYSTEM_TEST_AUDIT_HEADER = "X-System-Test-Audit";
const SYSTEM_TEST_CLEANUP_RETRY_MS = 250;
const SYSTEM_TEST_CLEANUP_MAX_FAILURES = 3;
export { SYSTEM_TEST_HEADER, SYSTEM_TEST_HEADER_VALUE, SYSTEM_TEST_RUN_ID_HEADER };

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

function responseMediaType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readResponseBody(response: Response): Promise<Readonly<{
  body: string;
  parsedJson: unknown | null;
}>> {
  if (response.status === 204 || response.status === 205) {
    await response.body?.cancel();
    return { body: "", parsedJson: null };
  }

  const mediaType = responseMediaType(response);
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    const raw = await response.text();
    if (!raw) return { body: "", parsedJson: null };
    const parsedJson = JSON.parse(raw) as unknown;
    return { body: JSON.stringify(parsedJson, null, 2), parsedJson };
  }

  if (mediaType.startsWith("text/") || mediaType === "application/x-ndjson" || mediaType === "application/ndjson") {
    return { body: await response.text(), parsedJson: null };
  }

  await response.body?.cancel();
  const contentLength = response.headers.get("content-length");
  const size = contentLength && /^\d+$/.test(contentLength) ? `; ${contentLength} bytes` : "";
  return {
    body: `[binary ${mediaType || "application/octet-stream"}${size}]`,
    parsedJson: null,
  };
}

export function buildSystemTestSummary(logs: readonly DebugLogEntry[]): SystemTestSummary {
  const attempted = logs.filter((entry) => (
    entry.category !== "Cleanup"
    && !(entry.skipped === true && entry.error === null)
  ));
  const failed = attempted.filter((entry) => (
    entry.error !== null || entry.status === null || entry.status >= 400
  ));
  return {
    total: attempted.length,
    passed: attempted.length - failed.length,
    failed: failed.length,
    errors: failed.map((entry) => ({
      category: entry.category,
      label: entry.label,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      error: entry.error,
    })),
  };
}

export async function requestSystemTestCleanup(
  runId: string,
  signal: AbortSignal,
): Promise<Readonly<{ status: number | null; body: string; error: string | null }>> {
  let consecutiveFailures = 0;
  while (!signal.aborted) {
    let response: Response;
    let body: string;
    try {
      response = await fetch(`/api/admin/status/system-test-runs/${encodeURIComponent(runId)}/cleanup`, {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
          [SYSTEM_TEST_RUN_ID_HEADER]: runId,
        },
      });
      body = await response.text();
    } catch (error) {
      if (signal.aborted) break;
      consecutiveFailures += 1;
      if (consecutiveFailures >= SYSTEM_TEST_CLEANUP_MAX_FAILURES) {
        return {
          status: null,
          body: "",
          error: error instanceof Error ? error.message : "Unknown cleanup error",
        };
      }
      await waitWithAbort(SYSTEM_TEST_CLEANUP_RETRY_MS, signal);
      continue;
    }
    let cleanupStatus: unknown;
    try {
      cleanupStatus = (JSON.parse(body) as { status?: unknown }).status;
    } catch {
      cleanupStatus = undefined;
    }
    if (response.ok) return { status: response.status, body, error: null };

    const progressing = response.status === 409
      && (cleanupStatus === "running" || cleanupStatus === "cleaning");
    const retryableFailure = response.status >= 500
      || (response.status === 409 && cleanupStatus === "cleanup_failed");
    if (progressing) {
      consecutiveFailures = 0;
      await waitWithAbort(SYSTEM_TEST_CLEANUP_RETRY_MS, signal);
      continue;
    }
    if (retryableFailure) {
      consecutiveFailures += 1;
      if (consecutiveFailures < SYSTEM_TEST_CLEANUP_MAX_FAILURES) {
        await waitWithAbort(SYSTEM_TEST_CLEANUP_RETRY_MS, signal);
        continue;
      }
    }
    return {
      status: response.status,
      body,
      error: `${response.status} ${response.statusText}`,
    };
  }
  return { status: null, body: "", error: "System-test cleanup timed out" };
}

export async function runEndpointTest(
  endpoint: EndpointDef,
  prepared: PreparedEndpointRequest,
  runId: string,
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
    const mergedHeaders: Record<string, string> = {
      ...prepared.headers,
      [SYSTEM_TEST_HEADER]: SYSTEM_TEST_HEADER_VALUE,
      [SYSTEM_TEST_AUDIT_HEADER]: "suppress",
      [SYSTEM_TEST_RUN_ID_HEADER]: runId,
    };
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
    const { body, parsedJson } = await readResponseBody(response);
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
