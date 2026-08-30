import { AppError, type RequestContext } from "@guild/kernel";
import type { PaginatedResponse } from "@guild/shared";
import { PERMISSION_ID } from "@guild/shared/constants/roles";

export const ERROR_LOG_SOURCES = ["request", "scheduler", "realtime", "audit"] as const;
export type ErrorLogSource = (typeof ERROR_LOG_SOURCES)[number];

export type ErrorLogEntry = Readonly<{
  id: string;
  source: ErrorLogSource;
  level: "error" | "warn";
  message: string;
  requestPath: string | null;
  requestMethod: string | null;
  requestId: string | null;
  stack: string | null;
  context: null;
  createdAt: string;
}>;

export type ErrorLogRecord = Omit<ErrorLogEntry, "context">;

export interface ErrorLogStore {
  insert(record: ErrorLogRecord): Promise<void>;
  list(query: Readonly<{
    source: ErrorLogSource | null;
    page: number;
    limit: number;
  }>): Promise<PaginatedResponse<ErrorLogEntry>>;
}

export class ErrorLogService {
  constructor(private readonly store: ErrorLogStore) {}

  async recordUnexpected(input: Readonly<{
    error: Error;
    requestId: string;
    requestPath: string;
    requestMethod: string;
    createdAt: string;
  }>): Promise<void> {
    const sensitiveValues = sensitivePathValues(input.requestPath);
    await this.store.insert({
      id: crypto.randomUUID(),
      source: "request",
      level: "error",
      message: bounded(redactValues(input.error.message || input.error.name || "Unexpected error", sensitiveValues), 2_000),
      requestPath: nullableBounded(redactSensitivePath(input.requestPath), 2_048),
      requestMethod: nullableBounded(input.requestMethod.toUpperCase(), 16),
      requestId: nullableBounded(input.requestId, 200),
      stack: nullableBounded(redactValues(input.error.stack ?? null, sensitiveValues), 4_000),
      createdAt: input.createdAt,
    });
  }

  async list(
    context: RequestContext,
    query: Readonly<{ source: ErrorLogSource | null; page: number; limit: number }>,
  ): Promise<PaginatedResponse<ErrorLogEntry>> {
    context.authorization.require(PERMISSION_ID.ADMIN_STATUS_VIEW);
    if (!Number.isInteger(query.page) || query.page < 1 || query.page > 100) throw invalid("Invalid error log page");
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw invalid("Invalid error log limit");
    if (query.source !== null && !ERROR_LOG_SOURCES.includes(query.source)) throw invalid("Invalid error log source");
    return this.store.list(query);
  }
}

const SENSITIVE_PATH_PATTERNS = [
  /^(\/api\/auth\/verify-invite\/)([^/?#]+)(.*)$/,
  /^(\/api\/auth\/register\/)([^/?#]+)(.*)$/,
] as const;

function sensitivePathValues(path: string): readonly string[] {
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    const match = path.match(pattern);
    if (!match?.[2]) continue;
    const values = new Set([match[2]]);
    try {
      values.add(decodeURIComponent(match[2]));
    } catch {
      // The raw path segment is still redacted when it is not valid percent-encoding.
    }
    return [...values].filter(Boolean);
  }
  return [];
}

function redactSensitivePath(path: string): string {
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(path)) return path.replace(pattern, "$1:redacted$3");
  }
  return path;
}

function redactValues(value: string, sensitiveValues: readonly string[]): string;
function redactValues(value: string | null, sensitiveValues: readonly string[]): string | null;
function redactValues(value: string | null, sensitiveValues: readonly string[]): string | null {
  if (value === null) return null;
  return sensitiveValues.reduce(
    (current, sensitive) => current.split(sensitive).join("[REDACTED]"),
    value,
  );
}

function bounded(value: string, length: number): string {
  const normalized = value.trim() || "Unexpected error";
  return normalized.slice(0, length);
}

function nullableBounded(value: string | null, length: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, length) : null;
}

function invalid(message: string): AppError {
  return new AppError({ code: "VALIDATION_ERROR", status: 400, message });
}
